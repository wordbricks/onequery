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
    | "RefreshSession"
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

async function refreshCliAccessToken(input: {
  baseUrl: string;
  cookieHeader: string;
}): Promise<string> {
  const refreshResponse = await callCliConnectRpc({
    baseUrl: input.baseUrl,
    body: {},
    cookieHeader: input.cookieHeader,
    method: "RefreshSession",
    requestId: "req_cli_refresh_session_123",
  });
  const payload = refreshResponse.payload as {
    accessToken?: unknown;
  };

  if (
    typeof payload.accessToken !== "string" ||
    payload.accessToken.length === 0
  ) {
    throw new Error("RefreshSession did not return an accessToken");
  }

  return payload.accessToken;
}

function runPackagedCliJsonCommand(input: {
  args: string[];
  env: Record<string, string>;
  stagedBundleRoot: string;
}): {
  output: {
    data: unknown;
    ok: boolean;
    requestId?: string;
  };
  stderr: string;
  stdout: string;
} {
  const result = runPackagedCliCommand(input);

  if (result.status !== 0) {
    throw new Error(
      `CLI command failed (${input.args.join(" ")}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  return {
    output: JSON.parse(result.stdout) as {
      data: unknown;
      ok: boolean;
      requestId?: string;
    },
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function runPackagedCliCommand(input: {
  args: string[];
  env: Record<string, string>;
  stagedBundleRoot: string;
}): {
  status: number | null;
  stderr: string;
  stdout: string;
} {
  const cliPath = resolveStagedCliPath(input.stagedBundleRoot);
  const result = spawnSync(cliPath, ["--output", "json", ...input.args], {
    cwd: cliRootDir,
    encoding: "utf8",
    env: createBundledRuntimeEnv(input.stagedBundleRoot, input.env),
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  return {
    status: result.status,
    stderr,
    stdout,
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

async function waitForGatewayShutdown(baseUrl: string): Promise<void> {
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/bootstrap`, {
        headers: {
          accept: "application/json",
        },
      });
      lastError = new Error(
        `gateway still responded with ${response.status}: ${await response.text()}`
      );
    } catch {
      return;
    }

    await Bun.sleep(250);
  }

  throw new Error(
    `timed out waiting for self-host shutdown: ${
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

async function startGatewayProcess(input: {
  env: Record<string, string>;
  stagedBundleRoot: string;
}) {
  const child = spawn(
    resolveStagedCliPath(input.stagedBundleRoot),
    ["gateway"],
    {
      cwd: cliRootDir,
      env: createBundledRuntimeEnv(input.stagedBundleRoot, input.env),
      stdio: "pipe",
    }
  );

  const output = collectProcessOutput(child);

  return {
    child,
    output,
  };
}

async function stopGatewayProcess(input: {
  child: ReturnType<typeof spawn>;
  env: Record<string, string>;
  homeDir: string;
  output: { read: () => string };
  stagedBundleRoot: string;
}): Promise<void> {
  const stagedCliPath = resolveStagedCliPath(input.stagedBundleRoot);
  const stopResult = spawnSync(stagedCliPath, ["gateway", "stop"], {
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

    // Comment: the packaged self-host runtime can finish a managed SIGTERM shutdown
    // and clear pid/lock markers before the foreground `onequery gateway` process
    // reports a nonzero exit. Smoke cleanup only needs to prove the runtime is
    // no longer live for the temp home directory.
    if (cleanedUp) {
      return;
    }

    throw new Error(
      `gateway stop exited with status ${stopResult.status} and runtime markers remained`
    );
  } catch (error) {
    input.child.kill("SIGKILL");
    throw new Error(
      `self-host gateway process failed to stop cleanly.\nstop output:\n${stopOutput}\ngateway output:\n${input.output.read()}\n${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

describe("CLI self-host smoke", () => {
  it("starts and stops the packaged gateway in background", async () => {
    const { baseUrl, env, homeDir, port, stagedBundleRoot } =
      await prepareSelfHostRuntime("onequery-cli-background-gateway-home-");
    const pidPath = join(homeDir, "data", "run", "server.pid");
    const lockPath = join(homeDir, "data", "run", "server.lock");

    writeSelfHostConfig(homeDir, port);

    try {
      const start = runPackagedCliJsonCommand({
        args: ["gateway", "start"],
        env,
        stagedBundleRoot,
      });
      expect(start.output).toMatchObject({
        ok: true,
        data: {
          kind: "gateway-start",
          processStarted: true,
          runtimeState: {
            running: true,
            status: "running",
          },
        },
      });

      await waitForBootstrap(baseUrl);

      const statusWhileRunning = runPackagedCliJsonCommand({
        args: ["gateway", "status"],
        env,
        stagedBundleRoot,
      });
      expect(statusWhileRunning.output).toMatchObject({
        ok: true,
        data: {
          kind: "gateway-status",
          runtimeState: {
            running: true,
            status: "running",
          },
        },
      });

      const stop = runPackagedCliJsonCommand({
        args: ["gateway", "stop"],
        env,
        stagedBundleRoot,
      });
      expect(stop.output).toMatchObject({
        ok: true,
        data: {
          kind: "gateway-stop",
          stopIssued: true,
          runtimeState: {
            running: false,
            status: "not_running",
          },
        },
      });

      await waitForGatewayShutdown(baseUrl);
      expect(existsSync(pidPath)).toBe(false);
      expect(existsSync(lockPath)).toBe(false);

      const statusAfterStop = runPackagedCliJsonCommand({
        args: ["gateway", "status"],
        env,
        stagedBundleRoot,
      });
      expect(statusAfterStop.output).toMatchObject({
        ok: true,
        data: {
          kind: "gateway-status",
          runtimeState: {
            running: false,
            status: "not_running",
          },
        },
      });
    } finally {
      runPackagedCliCommand({
        args: ["gateway", "stop"],
        env,
        stagedBundleRoot,
      });
      rmSync(homeDir, {
        force: true,
        recursive: true,
      });
    }
  }, 240_000);

  it("bootstraps a fresh self-host runtime and serves Connect-backed CLI RPCs through the packaged gateway path", async () => {
    const { baseUrl, env, homeDir, port, stagedBundleRoot } =
      await prepareSelfHostRuntime("onequery-cli-self-host-home-");

    writeSelfHostConfig(homeDir, port);

    const handle = await startGatewayProcess({
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
        cookieHeader,
        method: "GetSession",
        requestId: "req_cli_session_123",
      });
      expect(sessionResponse.payload).toMatchObject({
        authMode: "CLI_AUTH_MODE_BROWSER_SESSION",
        user: {
          email: "owner@example.com",
        },
      });

      const organizationsResponse = await callCliConnectRpc({
        baseUrl,
        body: {
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
        title: expect.any(String),
      });

      const connectSourceResponse = await callCliConnectRpc({
        baseUrl,
        body: {
          credentials: {
            postgres: {
              database: "analytics",
              host: "localhost",
              password: "password",
              port: 5432,
              sslMode: "prefer",
              username: "postgres",
            },
          },
          name: "Warehouse",
          orgSlug: "owner-org",
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
          orgSlug: "owner-org",
          sourceKey: "Warehouse",
        },
        cookieHeader,
        method: "GetSource",
        requestId: "req_cli_source_123",
      });
      expect(sourceResponse.payload).toMatchObject({
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
      await stopGatewayProcess({
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

  it("runs the packaged CLI against the self-host Connect API", async () => {
    const { baseUrl, env, homeDir, port, stagedBundleRoot } =
      await prepareSelfHostRuntime("onequery-cli-connect-cli-home-");

    writeSelfHostConfig(homeDir, port);

    const handle = await startGatewayProcess({
      env,
      stagedBundleRoot,
    });

    try {
      await waitForBootstrap(baseUrl);

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
      const cookieHeader = buildCookieHeader(bootstrapResponse.headers);
      if (!cookieHeader) {
        throw new Error("bootstrap did not return a session cookie");
      }

      const accessToken = await refreshCliAccessToken({
        baseUrl,
        cookieHeader,
      });
      const cliEnv = {
        ...env,
        ONEQUERY_ACCESS_TOKEN: accessToken,
        ONEQUERY_BASE_URL: baseUrl,
      };

      const whoami = runPackagedCliJsonCommand({
        args: [
          "--request-id",
          "req_cli_cmd_whoami_123",
          "auth",
          "whoami",
          "--fields",
          "user.email",
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(whoami.output).toMatchObject({
        ok: true,
        requestId: "req_cli_cmd_whoami_123",
        data: {
          user: {
            email: "owner@example.com",
          },
        },
      });

      const orgUse = runPackagedCliJsonCommand({
        args: [
          "--request-id",
          "req_cli_cmd_org_use_123",
          "org",
          "use",
          "owner-org",
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(orgUse.output).toMatchObject({
        ok: true,
        requestId: "req_cli_cmd_org_use_123",
        data: {
          activeOrg: "owner-org",
          changed: true,
        },
      });

      const orgCurrent = runPackagedCliJsonCommand({
        args: ["org", "current"],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(orgCurrent.output).toMatchObject({
        ok: true,
        data: {
          org: "owner-org",
          resolved: true,
          source: "config",
        },
      });

      const authSessionRefresh = runPackagedCliJsonCommand({
        args: [
          "--request-id",
          "req_cli_cmd_auth_refresh_123",
          "auth",
          "session",
          "refresh",
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(authSessionRefresh.output).toMatchObject({
        ok: true,
        requestId: "req_cli_cmd_auth_refresh_123",
        data: {
          accessTokenRedacted: true,
        },
      });

      const orgGet = runPackagedCliJsonCommand({
        args: [
          "--request-id",
          "req_cli_cmd_org_get_123",
          "org",
          "get",
          "--fields",
          "slug,capabilities",
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(orgGet.output).toMatchObject({
        ok: true,
        requestId: "req_cli_cmd_org_get_123",
        data: {
          slug: "owner-org",
        },
      });

      const sourceConnect = runPackagedCliJsonCommand({
        args: [
          "--request-id",
          "req_cli_cmd_source_connect_123",
          "source",
          "connect",
          "--source",
          "postgres",
          "--input",
          JSON.stringify({
            name: "warehouse-cli",
            credentials: {
              database: "analytics",
              host: "localhost",
              password: "password",
              port: 5432,
              sslMode: "prefer",
              username: "postgres",
            },
          }),
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(sourceConnect.output).toMatchObject({
        ok: true,
        requestId: "req_cli_cmd_source_connect_123",
        data: {
          nextCommand: "onequery source show warehouse-cli",
          source: {
            name: "warehouse-cli",
            provider: "postgres",
            queryable: true,
            status: "active",
          },
        },
      });

      const sourceList = runPackagedCliJsonCommand({
        args: [
          "--request-id",
          "req_cli_cmd_source_list_123",
          "source",
          "list",
          "--fields",
          "sources.name,sources.status",
          "--page-size",
          "1",
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(sourceList.output).toMatchObject({
        ok: true,
        requestId: "req_cli_cmd_source_list_123",
        data: {
          sources: [
            {
              name: "warehouse-cli",
              status: "active",
            },
          ],
        },
      });

      const sourceShow = runPackagedCliJsonCommand({
        args: [
          "--request-id",
          "req_cli_cmd_source_show_123",
          "source",
          "show",
          "warehouse-cli",
          "--fields",
          "name,queryable",
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(sourceShow.output).toMatchObject({
        ok: true,
        requestId: "req_cli_cmd_source_show_123",
        data: {
          name: "warehouse-cli",
          queryable: true,
        },
      });

      const queryValidate = runPackagedCliJsonCommand({
        args: [
          "--request-id",
          "req_cli_cmd_query_validate_123",
          "query",
          "validate",
          "--source",
          "warehouse-cli",
          "--sql",
          "select 1",
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(queryValidate.output).toMatchObject({
        ok: true,
        requestId: "req_cli_cmd_query_validate_123",
        data: {
          normalizedSql: expect.any(String),
          source: {
            name: "warehouse-cli",
          },
        },
      });

      const useSkill = runPackagedCliJsonCommand({
        args: [
          "--request-id",
          "req_cli_cmd_use_123",
          "--org",
          "owner-org",
          "use",
          "--source",
          "github",
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(useSkill.output).toMatchObject({
        ok: true,
        requestId: "req_cli_cmd_use_123",
        data: {
          source: "github",
          title: expect.any(String),
        },
      });
    } catch (error) {
      throw new Error(
        `self-host cli smoke failed.\n${handle.output.read()}\n${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    } finally {
      await stopGatewayProcess({
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

    const handle = await startGatewayProcess({
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
