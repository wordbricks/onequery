import { afterAll, describe, expect, it } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cleanupPath,
  cliRootDir,
  createBundledRuntimeEnv,
  createStagedBundleRoot,
  resolveStagedCliPath,
} from "./self-host-runtime.js";

const STARTUP_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

let stagedBundleRootPromise: Promise<string> | null = null;

function getStagedBundleRoot(): Promise<string> {
  if (!stagedBundleRootPromise) {
    stagedBundleRootPromise = createStagedBundleRoot();
  }

  return stagedBundleRootPromise;
}

afterAll(async () => {
  if (!stagedBundleRootPromise) {
    return;
  }

  cleanupPath(await stagedBundleRootPromise);
});

function createTempHomeDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function prepareSelfHostRuntime(prefix: string): Promise<{
  baseUrl: string;
  env: Record<string, string>;
  homeDir: string;
  port: number;
  stagedBundleRoot: string;
}> {
  const stagedBundleRoot = await getStagedBundleRoot();
  const homeDir = createTempHomeDir(prefix);
  const port = await findOpenPort();
  const env = {
    ONEQUERY_HOME: homeDir,
  };

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    env,
    homeDir,
    port,
    stagedBundleRoot,
  };
}

function writeSelfHostConfig(homeDir: string, port: number): void {
  const configDir = join(homeDir, "config", "self-host");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "config.toml"),
    `[server]\nlisten_host = "127.0.0.1"\nport = ${port}\n`
  );
}

function writeInvalidSecrets(homeDir: string): void {
  const configDir = join(homeDir, "config", "self-host");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "secrets.toml"),
    '[auth]\nsecret = "better"\n\n[crypto]\nmaster_encryption_key = "master"\n\n[connectors]\nenrollment_token = "connector"\n'
  );
}

async function findOpenPort(): Promise<number> {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data() {},
      open() {},
    },
  });

  try {
    return listener.port;
  } finally {
    listener.stop(true);
  }
}

function getSetCookieValues(headers: Headers): string[] {
  const headersWithGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headersWithGetSetCookie.getSetCookie?.();

  if (Array.isArray(setCookies) && setCookies.length > 0) {
    return setCookies;
  }

  const singleValue = headers.get("set-cookie");
  return singleValue ? [singleValue] : [];
}

function buildCookieHeader(headers: Headers): string | null {
  const cookies = getSetCookieValues(headers)
    .map((setCookie) => setCookie.split(";")[0]?.trim())
    .filter((value): value is string => Boolean(value));

  if (cookies.length === 0) {
    return null;
  }

  return cookies.join("; ");
}

function collectProcessOutput(child: ReturnType<typeof spawn>): {
  read: () => string;
} {
  let stdout = "";
  let stderr = "";

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  return {
    read() {
      return `${stdout}${stderr}`;
    },
  };
}

async function callCliConnectRpc(input: {
  baseUrl: string;
  method:
    | "Use"
    | "GetSession"
    | "ListOrganizations"
    | "GetOrganization"
    | "GetSourceConnectGuide"
    | "ConnectSource"
    | "ListSources"
    | "GetSource";
  body?: unknown;
  cookieHeader?: string | null;
  requestId: string;
}): Promise<{ payload: unknown; response: Response }> {
  const response = await fetch(
    `${input.baseUrl}/api/cli/onequery.cli.v1.CliService/${input.method}`,
    {
      body: JSON.stringify(input.body ?? {}),
      headers: {
        "Connect-Protocol-Version": "1",
        "content-type": "application/json",
        ...(input.cookieHeader ? { cookie: input.cookieHeader } : {}),
        "x-request-id": input.requestId,
      },
      method: "POST",
    }
  );

  const rawBody = await response.text();
  const payload = rawBody.length === 0 ? null : JSON.parse(rawBody);

  if (!response.ok) {
    throw new Error(
      `Connect RPC ${input.method} failed with ${response.status}: ${rawBody}`
    );
  }

  expect(response.headers.get("x-request-id")).toBe(input.requestId);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(payload && typeof payload === "object" && "requestId" in payload).toBe(
    false
  );

  return {
    payload,
    response,
  };
}

async function waitForBootstrap(baseUrl: string): Promise<Response> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/bootstrap`, {
        headers: {
          accept: "application/json",
        },
      });
      if (response.ok) {
        return response;
      }

      lastError = new Error(
        `unexpected bootstrap status ${response.status}: ${await response.text()}`
      );
    } catch (error) {
      lastError = error;
    }

    await Bun.sleep(250);
  }

  throw new Error(
    `timed out waiting for self-host bootstrap endpoint: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const exitPromise = once(child, "exit").then(([code, signal]) => ({
    code: typeof code === "number" ? code : null,
    signal: signal ?? null,
  }));

  const timeoutPromise = Bun.sleep(timeoutMs).then(() => {
    throw new Error(`process did not exit within ${timeoutMs}ms`);
  });

  return Promise.race([exitPromise, timeoutPromise]);
}

async function startServeProcess(input: {
  env: Record<string, string>;
  stagedBundleRoot: string;
}) {
  const child = spawn(resolveStagedCliPath(input.stagedBundleRoot), ["serve"], {
    cwd: cliRootDir,
    env: createBundledRuntimeEnv(input.stagedBundleRoot, input.env),
    stdio: "pipe",
  });

  const output = collectProcessOutput(child);

  return {
    child,
    output,
  };
}

async function stopServeProcess(input: {
  child: ReturnType<typeof spawn>;
  env: Record<string, string>;
  homeDir: string;
  output: { read: () => string };
  stagedBundleRoot: string;
}): Promise<void> {
  const stagedCliPath = resolveStagedCliPath(input.stagedBundleRoot);
  const stopResult = spawnSync(stagedCliPath, ["serve", "stop"], {
    cwd: cliRootDir,
    encoding: "utf8",
    env: createBundledRuntimeEnv(input.stagedBundleRoot, input.env),
  });

  const stopOutput =
    `${stopResult.stdout ?? ""}${stopResult.stderr ?? ""}`.trim();
  const pidPath = join(input.homeDir, "data", "run", "server.pid");
  const lockPath = join(input.homeDir, "data", "run", "server.lock");

  try {
    const exit = await waitForExit(input.child, SHUTDOWN_TIMEOUT_MS);
    const cleanedUp = !existsSync(pidPath) && !existsSync(lockPath);

    if (
      cleanedUp &&
      (stopResult.status === 0 || exit.code === 0 || exit.code === 10)
    ) {
      return;
    }

    // Comment: the packaged Bun server can finish a managed SIGTERM shutdown
    // and clear pid/lock markers before the foreground `onequery serve` process
    // reports a nonzero exit. Smoke cleanup only needs to prove the runtime is
    // no longer live for the temp home directory.
    if (cleanedUp) {
      return;
    }

    throw new Error(
      `serve stop exited with status ${stopResult.status} and runtime markers remained`
    );
  } catch (error) {
    input.child.kill("SIGKILL");
    throw new Error(
      `self-host serve process failed to stop cleanly.\nstop output:\n${stopOutput}\nserve output:\n${input.output.read()}\n${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

describe("CLI self-host smoke", () => {
  it("bootstraps a fresh self-host runtime and serves Connect-backed CLI RPCs through the packaged serve path", async () => {
    const { baseUrl, env, homeDir, port, stagedBundleRoot } =
      await prepareSelfHostRuntime("onequery-cli-self-host-home-");

    writeSelfHostConfig(homeDir, port);

    const handle = await startServeProcess({
      env,
      stagedBundleRoot,
    });

    try {
      const bootstrapStateResponse = await waitForBootstrap(baseUrl);
      const bootstrapStatePayload = (await bootstrapStateResponse.json()) as {
        isBootstrapped: boolean;
        needsBootstrap: boolean;
      };

      expect(bootstrapStatePayload).toMatchObject({
        isBootstrapped: false,
        needsBootstrap: true,
      });

      const bootstrapResponse = await fetch(
        `${baseUrl}/api/bootstrap/complete`,
        {
          body: JSON.stringify({
            email: "owner@example.com",
            name: "Owner",
            organizationName: "Owner Org",
            organizationSlug: "owner-org",
            password: "password123",
          }),
          headers: {
            "content-type": "application/json",
            origin: baseUrl,
          },
          method: "POST",
        }
      );

      expect(bootstrapResponse.status).toBe(201);

      const bootstrapPayload = (await bootstrapResponse.json()) as {
        bootstrap: {
          organizationId: string;
          organizationSlug: string;
        };
      };
      const cookieHeader = buildCookieHeader(bootstrapResponse.headers);

      expect(bootstrapPayload).toMatchObject({
        bootstrap: {
          organizationSlug: "owner-org",
        },
      });

      const useResponse = await callCliConnectRpc({
        baseUrl,
        body: {
          source: "CLI_USE_SOURCE_GITHUB",
        },
        method: "Use",
        requestId: "req_cli_use_123",
      });
      expect(useResponse.payload).toMatchObject({
        content: expect.any(String),
        description: expect.any(String),
        format: "CLI_CONTENT_FORMAT_MARKDOWN",
        source: "CLI_USE_SOURCE_GITHUB",
        title: expect.any(String),
      });

      const sessionResponse = await callCliConnectRpc({
        baseUrl,
        body: {
          fields: "user.email,activeOrgSlug",
        },
        cookieHeader,
        method: "GetSession",
        requestId: "req_cli_session_123",
      });
      expect(sessionResponse.payload).toEqual({
        user: {
          email: "owner@example.com",
        },
      });

      const organizationsResponse = await callCliConnectRpc({
        baseUrl,
        body: {
          fields: "organizations.slug",
          limit: 1,
        },
        cookieHeader,
        method: "ListOrganizations",
        requestId: "req_cli_orgs_123",
      });
      expect(organizationsResponse.payload).toMatchObject({
        organizations: [{ slug: "owner-org" }],
        page: {
          returned: "1",
        },
      });

      const organizationResponse = await callCliConnectRpc({
        baseUrl,
        body: {
          fields: "slug,capabilities",
          orgSlug: "owner-org",
        },
        cookieHeader,
        method: "GetOrganization",
        requestId: "req_cli_org_123",
      });
      expect(organizationResponse.payload).toMatchObject({
        capabilities: expect.arrayContaining([
          "CLI_ORG_CAPABILITY_SOURCE_CONNECT",
        ]),
        slug: "owner-org",
      });

      const guideResponse = await callCliConnectRpc({
        baseUrl,
        body: {
          orgSlug: "owner-org",
          source: "CLI_SOURCE_PROVIDER_POSTGRES",
        },
        cookieHeader,
        method: "GetSourceConnectGuide",
        requestId: "req_cli_guide_123",
      });
      expect(guideResponse.payload).toMatchObject({
        command: expect.stringContaining(
          "onequery source connect --source postgres"
        ),
        providers: expect.arrayContaining([
          expect.objectContaining({
            provider: "CLI_SOURCE_PROVIDER_POSTGRES",
          }),
        ]),
        title: expect.any(String),
      });

      const connectSourceResponse = await callCliConnectRpc({
        baseUrl,
        body: {
          credentials: {
            database: "analytics",
            host: "localhost",
            password: "password",
            port: 5432,
            sslMode: "prefer",
            type: "postgres",
            username: "postgres",
          },
          name: "Warehouse",
          orgSlug: "owner-org",
          source: "CLI_SOURCE_PROVIDER_POSTGRES",
        },
        cookieHeader,
        method: "ConnectSource",
        requestId: "req_cli_connect_source_123",
      });
      expect(connectSourceResponse.payload).toMatchObject({
        nextCommand: "onequery source show Warehouse",
        source: {
          name: "Warehouse",
          provider: "CLI_SOURCE_PROVIDER_POSTGRES",
          queryable: true,
          status: "CLI_SOURCE_STATUS_ACTIVE",
        },
      });

      const sourcesResponse = await callCliConnectRpc({
        baseUrl,
        body: {
          fields: "sources.name,sources.status",
          limit: 1,
          orgSlug: "owner-org",
        },
        cookieHeader,
        method: "ListSources",
        requestId: "req_cli_sources_123",
      });
      expect(sourcesResponse.payload).toMatchObject({
        sources: [
          {
            name: "Warehouse",
            status: "CLI_SOURCE_STATUS_ACTIVE",
          },
        ],
        page: {
          returned: "1",
        },
      });

      const sourceResponse = await callCliConnectRpc({
        baseUrl,
        body: {
          fields: "name,queryable",
          orgSlug: "owner-org",
          sourceKey: "Warehouse",
        },
        cookieHeader,
        method: "GetSource",
        requestId: "req_cli_source_123",
      });
      expect(sourceResponse.payload).toEqual({
        name: "Warehouse",
        queryable: true,
      });
    } catch (error) {
      throw new Error(
        `self-host smoke failed.\n${handle.output.read()}\n${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    } finally {
      await stopServeProcess({
        child: handle.child,
        env,
        homeDir,
        output: handle.output,
        stagedBundleRoot,
      });
      rmSync(homeDir, {
        force: true,
        recursive: true,
      });
    }
  }, 240_000);

  it("fails on startup when self-host secrets contain an invalid master key", async () => {
    const { env, homeDir, port, stagedBundleRoot } =
      await prepareSelfHostRuntime("onequery-cli-invalid-master-key-");

    writeSelfHostConfig(homeDir, port);
    writeInvalidSecrets(homeDir);

    const handle = await startServeProcess({
      env,
      stagedBundleRoot,
    });

    try {
      const exit = await waitForExit(handle.child, 20_000);
      const output = handle.output.read();

      expect(exit.code).not.toBe(0);
      expect(output).toContain("invalid self-host secrets config");
      expect(output).toContain("crypto.master_encryption_key");
      expect(existsSync(join(homeDir, "data", "run", "server.pid"))).toBe(
        false
      );
    } finally {
      rmSync(homeDir, {
        force: true,
        recursive: true,
      });
    }
  }, 240_000);
});
