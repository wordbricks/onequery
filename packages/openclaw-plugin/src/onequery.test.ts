import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLUGIN_CONFIG,
  createToolRegistrations,
  isObviouslyMutatingSql,
  resolvePluginConfig,
} from "./onequery";

type RunnerArgs = {
  args: string[];
  binaryPath: string;
};

function parseToolPayload(text: string): unknown {
  return JSON.parse(text);
}

describe("resolvePluginConfig", () => {
  it("uses defaults when config is missing", () => {
    expect(resolvePluginConfig(undefined)).toEqual(DEFAULT_PLUGIN_CONFIG);
  });

  it("accepts positive overrides", () => {
    expect(
      resolvePluginConfig({
        binaryPath: "/usr/local/bin/onequery",
        defaultCellMaxChars: 99,
        defaultMaxBytes: 1234,
        defaultMaxRows: 55,
        defaultQueryTimeoutMs: 7890,
      })
    ).toEqual({
      binaryPath: "/usr/local/bin/onequery",
      defaultCellMaxChars: 99,
      defaultMaxBytes: 1234,
      defaultMaxRows: 55,
      defaultQueryTimeoutMs: 7890,
    });
  });
});

describe("isObviouslyMutatingSql", () => {
  it("allows read-only selects", () => {
    expect(isObviouslyMutatingSql("select 1")).toBe(false);
    expect(
      isObviouslyMutatingSql(
        "with recent as (select * from events) select * from recent limit 10"
      )
    ).toBe(false);
  });

  it("ignores quoted content when scanning for mutating keywords", () => {
    expect(
      isObviouslyMutatingSql(
        "select * from audit where action = 'update' and detail like 'delete from users'"
      )
    ).toBe(false);
    expect(
      isObviouslyMutatingSql(
        'select "update" from "audit" where note = $$grant admin$$'
      )
    ).toBe(false);
    expect(isObviouslyMutatingSql("select [delete from] from [grant]")).toBe(
      false
    );
  });

  it("rejects obvious writes", () => {
    expect(isObviouslyMutatingSql("update users set admin = true")).toBe(true);
    expect(
      isObviouslyMutatingSql(
        "with doomed as (select * from users) delete from users where id in (select id from doomed)"
      )
    ).toBe(true);
  });
});

describe("tool registrations", () => {
  it("registers only optional tools", () => {
    const registrations = createToolRegistrations({ ...DEFAULT_PLUGIN_CONFIG });

    expect(registrations.map((entry) => entry.tool.name)).toEqual([
      "onequery_auth_whoami",
      "onequery_org_current",
      "onequery_org_list",
      "onequery_source_list",
      "onequery_source_show",
      "onequery_query_validate",
      "onequery_query_exec",
    ]);

    for (const registration of registrations) {
      expect(registration.options).toEqual({ optional: true });
    }
  });

  it("passes explicit org and pagination flags to source list", async () => {
    const calls: RunnerArgs[] = [];
    const registrations = createToolRegistrations(
      { ...DEFAULT_PLUGIN_CONFIG },
      async (binaryPath, args) => {
        calls.push({ args, binaryPath });
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            command: "source list",
            data: { sources: [] },
            ok: true,
            warnings: [],
          }),
        };
      }
    );

    const tool = registrations.find(
      (entry) => entry.tool.name === "onequery_source_list"
    )?.tool;

    if (!tool) {
      throw new Error("source list tool missing");
    }

    const result = await tool.execute("call-1", {
      fields: "sources,page",
      org: "wb",
      pageAll: true,
      pageSize: 25,
      requestId: "rq-123",
    });

    expect(calls).toEqual([
      {
        args: [
          "--org",
          "wb",
          "--request-id",
          "rq-123",
          "--output",
          "json",
          "source",
          "list",
          "--fields",
          "sources,page",
          "--page-size",
          "25",
          "--page-all",
        ],
        binaryPath: "onequery",
      },
    ]);

    const payload = parseToolPayload(result.content[0]?.text ?? "") as {
      ok: boolean;
      plugin: { cliCommand: string };
    };

    expect(payload.ok).toBe(true);
    expect(payload.plugin.cliCommand).toContain("onequery --org wb");
  });

  it("keeps pagination exec-only for query validate", async () => {
    const calls: RunnerArgs[] = [];
    const registrations = createToolRegistrations(
      { ...DEFAULT_PLUGIN_CONFIG },
      async (binaryPath, args) => {
        calls.push({ args, binaryPath });
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            command: "query validate",
            data: { valid: true },
            ok: true,
            warnings: [],
          }),
        };
      }
    );

    const validateTool = registrations.find(
      (entry) => entry.tool.name === "onequery_query_validate"
    )?.tool;
    const execTool = registrations.find(
      (entry) => entry.tool.name === "onequery_query_exec"
    )?.tool;

    if (!validateTool || !execTool) {
      throw new Error("query tools missing");
    }

    const validateProperties = (
      validateTool.parameters as {
        properties?: Record<string, unknown>;
      }
    ).properties;
    const execProperties = (
      execTool.parameters as {
        properties?: Record<string, unknown>;
      }
    ).properties;

    expect(validateProperties?.cursor).toBeUndefined();
    expect(validateProperties?.pageAll).toBeUndefined();
    expect(validateProperties?.pageSize).toBeUndefined();
    expect(execProperties?.cursor).toBeDefined();
    expect(execProperties?.pageAll).toBeDefined();
    expect(execProperties?.pageSize).toBeDefined();

    await validateTool.execute("call-validate", {
      cursor: "cursor-1",
      org: "wb",
      pageAll: true,
      pageSize: 25,
      source: "warehouse",
      sql: "select 1",
    });

    expect(calls).toEqual([
      {
        args: [
          "--org",
          "wb",
          "--output",
          "json",
          "query",
          "validate",
          "--source",
          "warehouse",
          "--sql",
          "select 1",
          "--max-rows",
          "100",
          "--max-bytes",
          "1048576",
          "--cell-max-chars",
          "2000",
          "--timeout-ms",
          "60000",
        ],
        binaryPath: "onequery",
      },
    ]);
  });

  it("applies bounded defaults to query exec", async () => {
    const calls: RunnerArgs[] = [];
    const registrations = createToolRegistrations(
      {
        binaryPath: "onequery",
        defaultCellMaxChars: 111,
        defaultMaxBytes: 222,
        defaultMaxRows: 333,
        defaultQueryTimeoutMs: 444,
      },
      async (binaryPath, args) => {
        calls.push({ args, binaryPath });
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            command: "query exec",
            data: { rows: [] },
            ok: true,
            warnings: [],
          }),
        };
      }
    );

    const tool = registrations.find(
      (entry) => entry.tool.name === "onequery_query_exec"
    )?.tool;

    if (!tool) {
      throw new Error("query exec tool missing");
    }

    await tool.execute("call-2", {
      org: "wb",
      source: "warehouse",
      sql: "select 1",
    });

    expect(calls).toEqual([
      {
        args: [
          "--org",
          "wb",
          "--output",
          "json",
          "query",
          "exec",
          "--source",
          "warehouse",
          "--sql",
          "select 1",
          "--max-rows",
          "333",
          "--max-bytes",
          "222",
          "--cell-max-chars",
          "111",
          "--timeout-ms",
          "444",
        ],
        binaryPath: "onequery",
      },
    ]);
  });

  it("rejects mutating SQL before invoking the CLI", async () => {
    const calls: RunnerArgs[] = [];
    const registrations = createToolRegistrations(
      { ...DEFAULT_PLUGIN_CONFIG },
      async (binaryPath, args) => {
        calls.push({ args, binaryPath });
        return {
          exitCode: 0,
          stderr: "",
          stdout: "",
        };
      }
    );

    const tool = registrations.find(
      (entry) => entry.tool.name === "onequery_query_exec"
    )?.tool;

    if (!tool) {
      throw new Error("query exec tool missing");
    }

    const result = await tool.execute("call-3", {
      org: "wb",
      source: "warehouse",
      sql: "delete from users",
    });

    expect(calls).toEqual([]);

    const payload = parseToolPayload(result.content[0]?.text ?? "") as {
      command: string;
      error: { stage: string; title: string };
      ok: boolean;
    };

    expect(payload.command).toBe("query exec");
    expect(payload.ok).toBe(false);
    expect(payload.error.stage).toBe("guard");
    expect(payload.error.title).toBe("mutating SQL rejected");
  });
});
