import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Type } from "@sinclair/typebox";

const execFileAsync = promisify(execFile);
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export const DEFAULT_PLUGIN_CONFIG = {
  binaryPath: "onequery",
  defaultMaxRows: 100,
  defaultMaxBytes: 1_048_576,
  defaultCellMaxChars: 2_000,
  defaultQueryTimeoutMs: 60_000,
} as const;

type ToolResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
  details: unknown;
};

type OneQueryError = {
  detail: string;
  retryable?: boolean;
  stage: string;
  title: string;
};

type OneQueryEnvelope = {
  command: string;
  data?: unknown;
  error?: OneQueryError;
  ok: boolean;
  page?: unknown;
  plugin?: {
    cliCommand: string;
    exitCode?: number;
    stderr?: string;
  };
  warnings?: unknown[];
};

type RunnerResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type Runner = (binaryPath: string, args: string[]) => Promise<RunnerResult>;

type ToolDefinition = {
  description: string;
  execute: (
    _id: string,
    params: Record<string, unknown>
  ) => Promise<ToolResult>;
  label: string;
  name: string;
  parameters: ReturnType<typeof Type.Object>;
};

export type OneQueryPluginConfig = {
  binaryPath: string;
  defaultCellMaxChars: number;
  defaultMaxBytes: number;
  defaultMaxRows: number;
  defaultQueryTimeoutMs: number;
};

export type ToolRegistration = {
  options: { optional: true };
  tool: ToolDefinition;
};

type ExecFileError = Error & {
  code?: number | string;
  stderr?: string;
  stdout?: string;
};

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

export function resolvePluginConfig(raw: unknown): OneQueryPluginConfig {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_PLUGIN_CONFIG };
  }

  const config = raw as Record<string, unknown>;

  return {
    binaryPath:
      typeof config.binaryPath === "string" && config.binaryPath.length > 0
        ? config.binaryPath
        : DEFAULT_PLUGIN_CONFIG.binaryPath,
    defaultCellMaxChars: readPositiveInteger(
      config.defaultCellMaxChars,
      DEFAULT_PLUGIN_CONFIG.defaultCellMaxChars
    ),
    defaultMaxBytes: readPositiveInteger(
      config.defaultMaxBytes,
      DEFAULT_PLUGIN_CONFIG.defaultMaxBytes
    ),
    defaultMaxRows: readPositiveInteger(
      config.defaultMaxRows,
      DEFAULT_PLUGIN_CONFIG.defaultMaxRows
    ),
    defaultQueryTimeoutMs: readPositiveInteger(
      config.defaultQueryTimeoutMs,
      DEFAULT_PLUGIN_CONFIG.defaultQueryTimeoutMs
    ),
  };
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value);
}

function formatCliCommand(binaryPath: string, args: string[]): string {
  return [binaryPath, ...args].map(shellQuote).join(" ");
}

function parseJsonEnvelope(stdout: string): OneQueryEnvelope | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
      const envelope = parsed as OneQueryEnvelope;
      if (
        typeof envelope.ok === "boolean" &&
        typeof envelope.command === "string"
      ) {
        return envelope;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function createEnvelope(
  command: string,
  ok: boolean,
  cliCommand: string,
  options: {
    data?: unknown;
    error?: OneQueryError;
    exitCode?: number;
    stderr?: string;
    warnings?: unknown[];
  } = {}
): OneQueryEnvelope {
  return {
    command,
    data: options.data,
    error: options.error,
    ok,
    plugin: {
      cliCommand,
      exitCode: options.exitCode,
      stderr: options.stderr?.trim() || undefined,
    },
    warnings: options.warnings,
  };
}

async function defaultRunner(
  binaryPath: string,
  args: string[]
): Promise<RunnerResult> {
  try {
    const result = await execFileAsync(binaryPath, args, {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER_BYTES,
    });

    return {
      exitCode: 0,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } catch (error) {
    const execError = error as ExecFileError;

    return {
      exitCode: typeof execError.code === "number" ? execError.code : 1,
      stderr: execError.stderr ?? execError.message,
      stdout: execError.stdout ?? "",
    };
  }
}

async function runOneQueryJson(
  binaryPath: string,
  args: string[],
  runner: Runner
): Promise<OneQueryEnvelope> {
  const command = formatCliCommand(binaryPath, args);
  const result = await runner(binaryPath, args);
  const parsed = parseJsonEnvelope(result.stdout);

  if (parsed) {
    return {
      ...parsed,
      plugin: {
        cliCommand: command,
        exitCode: result.exitCode === 0 ? undefined : result.exitCode,
        stderr: result.stderr.trim() || undefined,
      },
    };
  }

  if (result.exitCode === 0) {
    return createEnvelope("unknown", true, command, {
      data: {
        stdout: result.stdout,
      },
      stderr: result.stderr,
    });
  }

  return createEnvelope("unknown", false, command, {
    error: {
      detail:
        result.stderr.trim() ||
        "The OneQuery CLI exited without a JSON error payload.",
      retryable: false,
      stage: "plugin",
      title: "onequery command failed",
    },
    exitCode: result.exitCode,
    stderr: result.stderr,
  });
}

function textResult(payload: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

function pushFlag(
  args: string[],
  flag: string,
  value: number | string | undefined
): void {
  if (value === undefined) {
    return;
  }

  args.push(flag, String(value));
}

function pushBooleanFlag(
  args: string[],
  flag: string,
  value: boolean | undefined
): void {
  if (value) {
    args.push(flag);
  }
}

function buildGlobalArgs(params: {
  org?: string;
  requestId?: string;
}): string[] {
  const args: string[] = [];

  pushFlag(args, "--org", params.org);
  pushFlag(args, "--request-id", params.requestId);
  args.push("--output", "json");

  return args;
}

function buildListArgs(
  command: string[],
  params: {
    cursor?: string;
    fields?: string;
    org?: string;
    pageAll?: boolean;
    pageSize?: number;
    requestId?: string;
  }
): string[] {
  const args = buildGlobalArgs(params);
  args.push(...command);
  pushFlag(args, "--fields", params.fields);
  pushFlag(args, "--page-size", params.pageSize);
  pushFlag(args, "--cursor", params.cursor);
  pushBooleanFlag(args, "--page-all", params.pageAll);
  return args;
}

function buildQueryArgs(
  action: "exec" | "validate",
  params: {
    cellMaxChars?: number;
    fields?: string;
    maxBytes?: number;
    maxRows?: number;
    org: string;
    pageAll?: boolean;
    pageSize?: number;
    requestId?: string;
    source: string;
    sql: string;
    timeoutMs?: number;
    cursor?: string;
  }
): string[] {
  const args = buildGlobalArgs(params);
  args.push("query", action, "--source", params.source);
  pushFlag(args, "--fields", params.fields);
  pushFlag(args, "--page-size", params.pageSize);
  pushFlag(args, "--cursor", params.cursor);
  pushBooleanFlag(args, "--page-all", params.pageAll);
  args.push("--sql", params.sql);
  pushFlag(args, "--max-rows", params.maxRows);
  pushFlag(args, "--max-bytes", params.maxBytes);
  pushFlag(args, "--cell-max-chars", params.cellMaxChars);
  pushFlag(args, "--timeout-ms", params.timeoutMs);
  return args;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");
}

const MUTATING_SQL_PATTERNS = [
  /\binsert\s+into\b/i,
  /\bupdate\b/i,
  /\bdelete\s+from\b/i,
  /\bmerge\s+into\b/i,
  /\bupsert\b/i,
  /\bcreate\s+(table|view|schema|database|index|role|user|function|procedure)\b/i,
  /\balter\s+(table|view|schema|database|index|role|user|function|procedure)\b/i,
  /\bdrop\s+(table|view|schema|database|index|role|user|function|procedure)\b/i,
  /\btruncate\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bcall\b/i,
  /\bcopy\b/i,
  /\bvacuum\b/i,
  /\banalyze\b/i,
  /\breindex\b/i,
  /\brefresh\s+materialized\b/i,
];

export function isObviouslyMutatingSql(sql: string): boolean {
  const normalizedSql = stripSqlComments(sql).replace(/\s+/g, " ").trim();

  return MUTATING_SQL_PATTERNS.some((pattern) => pattern.test(normalizedSql));
}

function createReadOnlyViolationEnvelope(
  binaryPath: string,
  args: string[]
): OneQueryEnvelope {
  return createEnvelope(
    "query exec",
    false,
    formatCliCommand(binaryPath, args),
    {
      error: {
        detail:
          "This plugin only allows read-only SQL. Rewrite the query as a SELECT or bounded aggregate.",
        retryable: false,
        stage: "guard",
        title: "mutating SQL rejected",
      },
    }
  );
}

const STRING_SCHEMA = Type.String({ minLength: 1 });
const POSITIVE_INTEGER_SCHEMA = Type.Integer({ minimum: 1 });

const REQUEST_FIELDS = {
  fields: Type.Optional(STRING_SCHEMA),
  requestId: Type.Optional(STRING_SCHEMA),
};

const PAGE_FIELDS = {
  cursor: Type.Optional(STRING_SCHEMA),
  pageAll: Type.Optional(Type.Boolean()),
  pageSize: Type.Optional(POSITIVE_INTEGER_SCHEMA),
};

const QUERY_LIMIT_FIELDS = {
  cellMaxChars: Type.Optional(POSITIVE_INTEGER_SCHEMA),
  maxBytes: Type.Optional(POSITIVE_INTEGER_SCHEMA),
  maxRows: Type.Optional(POSITIVE_INTEGER_SCHEMA),
  timeoutMs: Type.Optional(POSITIVE_INTEGER_SCHEMA),
};

function createSourceListTool(
  config: OneQueryPluginConfig,
  runner: Runner
): ToolRegistration {
  return {
    options: { optional: true },
    tool: {
      description: "List sources visible to an explicit OneQuery org.",
      execute: async (_id, params) => {
        const args = buildListArgs(["source", "list"], {
          cursor: typeof params.cursor === "string" ? params.cursor : undefined,
          fields: typeof params.fields === "string" ? params.fields : undefined,
          org: typeof params.org === "string" ? params.org : undefined,
          pageAll: params.pageAll === true,
          pageSize:
            typeof params.pageSize === "number" ? params.pageSize : undefined,
          requestId:
            typeof params.requestId === "string" ? params.requestId : undefined,
        });

        return textResult(
          await runOneQueryJson(config.binaryPath, args, runner)
        );
      },
      label: "OneQuery Source List",
      name: "onequery_source_list",
      parameters: Type.Object({
        ...REQUEST_FIELDS,
        ...PAGE_FIELDS,
        org: STRING_SCHEMA,
      }),
    },
  };
}

function createSourceShowTool(
  config: OneQueryPluginConfig,
  runner: Runner
): ToolRegistration {
  return {
    options: { optional: true },
    tool: {
      description: "Show one source by key for an explicit OneQuery org.",
      execute: async (_id, params) => {
        const source = typeof params.source === "string" ? params.source : "";
        const args = buildGlobalArgs({
          org: typeof params.org === "string" ? params.org : undefined,
          requestId:
            typeof params.requestId === "string" ? params.requestId : undefined,
        });

        args.push("source", "show", source);
        pushFlag(
          args,
          "--fields",
          typeof params.fields === "string" ? params.fields : undefined
        );

        return textResult(
          await runOneQueryJson(config.binaryPath, args, runner)
        );
      },
      label: "OneQuery Source Show",
      name: "onequery_source_show",
      parameters: Type.Object({
        ...REQUEST_FIELDS,
        org: STRING_SCHEMA,
        source: STRING_SCHEMA,
      }),
    },
  };
}

function createQueryTool(
  action: "exec" | "validate",
  config: OneQueryPluginConfig,
  runner: Runner
): ToolRegistration {
  const name =
    action === "exec" ? "onequery_query_exec" : "onequery_query_validate";
  const description =
    action === "exec"
      ? "Execute a bounded read-only SQL query against a OneQuery source."
      : "Validate a bounded read-only SQL query against a OneQuery source.";

  return {
    options: { optional: true },
    tool: {
      description,
      execute: async (_id, params) => {
        const sql = typeof params.sql === "string" ? params.sql : "";
        const args = buildQueryArgs(action, {
          cellMaxChars:
            typeof params.cellMaxChars === "number"
              ? params.cellMaxChars
              : config.defaultCellMaxChars,
          cursor: typeof params.cursor === "string" ? params.cursor : undefined,
          fields: typeof params.fields === "string" ? params.fields : undefined,
          maxBytes:
            typeof params.maxBytes === "number"
              ? params.maxBytes
              : config.defaultMaxBytes,
          maxRows:
            typeof params.maxRows === "number"
              ? params.maxRows
              : config.defaultMaxRows,
          org: typeof params.org === "string" ? params.org : "",
          pageAll: params.pageAll === true,
          pageSize:
            typeof params.pageSize === "number" ? params.pageSize : undefined,
          requestId:
            typeof params.requestId === "string" ? params.requestId : undefined,
          source: typeof params.source === "string" ? params.source : "",
          sql,
          timeoutMs:
            typeof params.timeoutMs === "number"
              ? params.timeoutMs
              : config.defaultQueryTimeoutMs,
        });

        // Surprising: OneQuery's query CLI does not expose an explicit read-only
        // mode here, so the plugin rejects obviously mutating SQL before delegating.
        if (isObviouslyMutatingSql(sql)) {
          return textResult(
            createReadOnlyViolationEnvelope(config.binaryPath, args)
          );
        }

        return textResult(
          await runOneQueryJson(config.binaryPath, args, runner)
        );
      },
      label:
        action === "exec" ? "OneQuery Query Exec" : "OneQuery Query Validate",
      name,
      parameters: Type.Object({
        ...REQUEST_FIELDS,
        ...PAGE_FIELDS,
        ...QUERY_LIMIT_FIELDS,
        org: STRING_SCHEMA,
        source: STRING_SCHEMA,
        sql: STRING_SCHEMA,
      }),
    },
  };
}

function createAuthWhoAmITool(
  config: OneQueryPluginConfig,
  runner: Runner
): ToolRegistration {
  return {
    options: { optional: true },
    tool: {
      description:
        "Show the authenticated OneQuery user and effective org context.",
      execute: async (_id, params) => {
        const args = buildGlobalArgs({
          requestId:
            typeof params.requestId === "string" ? params.requestId : undefined,
        });

        args.push("auth", "whoami");
        pushFlag(
          args,
          "--fields",
          typeof params.fields === "string" ? params.fields : undefined
        );

        return textResult(
          await runOneQueryJson(config.binaryPath, args, runner)
        );
      },
      label: "OneQuery Auth WhoAmI",
      name: "onequery_auth_whoami",
      parameters: Type.Object({
        ...REQUEST_FIELDS,
      }),
    },
  };
}

function createOrgCurrentTool(
  config: OneQueryPluginConfig,
  runner: Runner
): ToolRegistration {
  return {
    options: { optional: true },
    tool: {
      description:
        "Show which org the OneQuery CLI will use for this invocation.",
      execute: async (_id, params) => {
        const args = buildGlobalArgs({
          requestId:
            typeof params.requestId === "string" ? params.requestId : undefined,
        });

        args.push("org", "current");

        return textResult(
          await runOneQueryJson(config.binaryPath, args, runner)
        );
      },
      label: "OneQuery Org Current",
      name: "onequery_org_current",
      parameters: Type.Object({
        requestId: Type.Optional(STRING_SCHEMA),
      }),
    },
  };
}

function createOrgListTool(
  config: OneQueryPluginConfig,
  runner: Runner
): ToolRegistration {
  return {
    options: { optional: true },
    tool: {
      description: "List orgs visible to the authenticated OneQuery user.",
      execute: async (_id, params) => {
        const args = buildListArgs(["org", "list"], {
          cursor: typeof params.cursor === "string" ? params.cursor : undefined,
          fields: typeof params.fields === "string" ? params.fields : undefined,
          pageAll: params.pageAll === true,
          pageSize:
            typeof params.pageSize === "number" ? params.pageSize : undefined,
          requestId:
            typeof params.requestId === "string" ? params.requestId : undefined,
        });

        return textResult(
          await runOneQueryJson(config.binaryPath, args, runner)
        );
      },
      label: "OneQuery Org List",
      name: "onequery_org_list",
      parameters: Type.Object({
        ...REQUEST_FIELDS,
        ...PAGE_FIELDS,
      }),
    },
  };
}

export function createToolRegistrations(
  config: OneQueryPluginConfig,
  runner: Runner = defaultRunner
): ToolRegistration[] {
  return [
    createAuthWhoAmITool(config, runner),
    createOrgCurrentTool(config, runner),
    createOrgListTool(config, runner),
    createSourceListTool(config, runner),
    createSourceShowTool(config, runner),
    createQueryTool("validate", config, runner),
    createQueryTool("exec", config, runner),
  ];
}
