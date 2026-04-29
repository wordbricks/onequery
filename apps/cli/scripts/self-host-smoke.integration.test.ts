import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { JsonObject } from "@bufbuild/protobuf";
import { durationFromMs, durationMs } from "@bufbuild/protobuf/wkt";
import type { CallOptions, Client } from "@connectrpc/connect";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { AuthMode } from "@onequery/proto-cli/cli/v1/auth_pb";
import {
  CliAuthService,
  CliOrganizationService,
  CliQueryService,
  CliSourceService,
} from "@onequery/proto-cli/cli/v1/cli_pb";
import { ContentFormat } from "@onequery/proto-cli/cli/v1/common_pb";
import {
  OrgCapability,
  OrganizationRole,
} from "@onequery/proto-cli/cli/v1/org_pb";
import {
  SourceConnectSslMode,
  SourceProvider,
  SourceQuerySupport,
  SourceStatus,
} from "@onequery/proto-cli/cli/v1/source_pb";
import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupPath,
  cliRootDir,
  createBundledRuntimeEnv,
  createStagedBundleRoot,
  resolveStagedCliPath,
} from "./self-host-runtime.js";

const STARTUP_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;
type CliConnectClient = {
  auth: Client<typeof CliAuthService>;
  organization: Client<typeof CliOrganizationService>;
  query: Client<typeof CliQueryService>;
  source: Client<typeof CliSourceService>;
};

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
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => {
          reject(
            new Error("expected a TCP address while resolving a free port")
          );
        });
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
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

function createCliConnectClient(baseUrl: string): CliConnectClient {
  // Comment: smoke coverage should bind to the generated service descriptor so
  // removed or renamed protobuf RPCs fail at compile time instead of drifting.
  const transport = createConnectTransport({
    baseUrl: `${baseUrl}/api/cli`,
    httpVersion: "1.1",
    useHttpGet: true,
  });
  return {
    auth: createClient(CliAuthService, transport),
    organization: createClient(CliOrganizationService, transport),
    query: createClient(CliQueryService, transport),
    source: createClient(CliSourceService, transport),
  };
}

async function callCliConnectRpc<T>(input: {
  call: (options: CallOptions) => Promise<T>;
  cookieHeader?: string | null;
  requestId: string;
}): Promise<{
  payload: T;
  responseHeaders: Headers;
  responseTrailers: Headers;
}> {
  let responseHeaders = new Headers();
  let responseTrailers = new Headers();
  const payload = await input.call({
    headers: {
      ...(input.cookieHeader ? { cookie: input.cookieHeader } : {}),
      "x-request-id": input.requestId,
    },
    onHeader(headers) {
      responseHeaders = headers;
    },
    onTrailer(trailers) {
      responseTrailers = trailers;
    },
  });

  const responseRequestId =
    responseHeaders.get("x-request-id") ??
    responseTrailers.get("x-request-id") ??
    null;
  expect(responseRequestId).toBe(input.requestId);

  return {
    payload,
    responseHeaders,
    responseTrailers,
  };
}

async function refreshCliAccessToken(input: {
  client: CliConnectClient;
  cookieHeader: string;
}): Promise<string> {
  const refreshResponse = await callCliConnectRpc({
    cookieHeader: input.cookieHeader,
    call: (options) => input.client.auth.refreshSession({}, options),
    requestId: "req_cli_refresh_session_123",
  });

  if (refreshResponse.payload.accessToken.length === 0) {
    throw new Error("RefreshSession did not return an accessToken");
  }

  return refreshResponse.payload.accessToken;
}

function requirePresent<T>(
  value: T | null | undefined,
  message: string
): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value;
}

function summarizeCliPage(value: {
  nextCursor: string;
  returnedCount: number;
}): JsonObject {
  return {
    ...(value.nextCursor ? { nextCursor: value.nextCursor } : {}),
    returnedCount: value.returnedCount.toString(),
  };
}

function summarizeCliSource(value: {
  displayName?: string;
  provider: SourceProvider;
  querySupport: SourceQuerySupport;
  sourceKey: string;
  status: SourceStatus;
}): JsonObject {
  return {
    ...(value.displayName ? { displayName: value.displayName } : {}),
    provider: SourceProvider[value.provider],
    queryable: value.querySupport === SourceQuerySupport.SUPPORTED,
    sourceKey: value.sourceKey,
    status: SourceStatus[value.status],
  };
}

function summarizeGetSessionResponse(
  value: Awaited<ReturnType<CliConnectClient["auth"]["getSession"]>>
): JsonObject {
  // Comment: generated protobuf submessages are optional in TypeScript even
  // when this smoke path treats them as required success invariants.
  const user = requirePresent(
    value.user,
    "GetSessionResponse.user must be present for a successful session lookup"
  );

  return {
    activeOrgSlug: value.activeOrgSlug,
    authMode: AuthMode[value.authMode],
    expiresAt: value.expiresAt ? "<timestamp>" : null,
    issuedAt: value.issuedAt ? "<timestamp>" : null,
    user: {
      displayName: user.displayName,
      email: user.email,
      id: "<redacted>",
    },
  };
}

function summarizeListOrganizationsResponse(
  value: Awaited<
    ReturnType<CliConnectClient["organization"]["listOrganizations"]>
  >
): JsonObject {
  const page = requirePresent(
    value.page,
    "ListOrganizationsResponse.page must be present for smoke snapshots"
  );

  return {
    organizations: value.organizations.map((organization) => ({
      name: organization.name,
      slug: organization.slug,
    })),
    page: summarizeCliPage(page),
  };
}

function summarizeGetOrganizationResponse(
  value: Awaited<
    ReturnType<CliConnectClient["organization"]["getOrganization"]>
  >
): JsonObject {
  // Comment: Connect-generated repeated enum fields in this smoke path are
  // iterable but do not consistently expose Array.prototype helpers.
  return {
    capabilities: Array.from(
      value.capabilities,
      (capability) => OrgCapability[capability]
    ),
    name: value.name,
    roles: Array.from(value.roles, (role) => OrganizationRole[role]),
    slug: value.slug,
  };
}

function summarizeGetSourceConnectGuideResponse(
  value: Awaited<
    ReturnType<CliConnectClient["source"]["getSourceConnectGuide"]>
  >
): JsonObject {
  return {
    command: value.command,
    content: value.content,
    description: value.description,
    format: ContentFormat[value.format],
    title: value.title,
  };
}

function summarizeConnectSourceResponse(
  value: Awaited<ReturnType<CliConnectClient["source"]["connectSource"]>>
): JsonObject {
  const source = requirePresent(
    value.source,
    "ConnectSourceResponse.source must be present for a successful source connect"
  );

  return {
    nextCommand: value.nextCommand,
    source: summarizeCliSource(source),
  };
}

function summarizeListSourcesResponse(
  value: Awaited<ReturnType<CliConnectClient["source"]["listSources"]>>
): JsonObject {
  const page = requirePresent(
    value.page,
    "ListSourcesResponse.page must be present for smoke snapshots"
  );

  return {
    page: summarizeCliPage(page),
    sources: value.sources.map((source) => summarizeCliSource(source)),
  };
}

function summarizeGetSourceResponse(
  value: Awaited<ReturnType<CliConnectClient["source"]["getSource"]>>
): JsonObject {
  const source = requirePresent(
    value.source,
    "GetSourceResponse.source must be present for a successful source lookup"
  );

  return {
    source: summarizeCliSource(source),
  };
}

function summarizeValidateQueryResponse(
  value: Awaited<ReturnType<CliConnectClient["query"]["validateQuery"]>>
): JsonObject {
  const declaredResultWindow = requirePresent(
    value.declaredResultWindow,
    "ValidateQueryResponse.declaredResultWindow must be present for successful validation"
  );
  const request = requirePresent(
    value.request,
    "ValidateQueryResponse.request must be present for successful validation"
  );
  const source = requirePresent(
    value.source,
    "ValidateQueryResponse.source must be present for successful validation"
  );

  return {
    declaredResultWindow: {
      cellMaxChars: declaredResultWindow.cellMaxChars,
      maxBytes: declaredResultWindow.maxBytes,
      maxRows: declaredResultWindow.maxRows,
      timeoutMs: durationMs(
        requirePresent(
          declaredResultWindow.timeout,
          "ValidateQueryResponse.declaredResultWindow.timeout must be present"
        )
      ),
    },
    normalizedSql: value.normalizedSql,
    request: {
      cellMaxChars: request.cellMaxChars,
      maxBytes: request.maxBytes,
      maxRows: request.maxRows,
      sql: request.sql,
      timeoutMs: durationMs(
        requirePresent(
          request.timeout,
          "ValidateQueryResponse.request.timeout must be present"
        )
      ),
    },
    source: summarizeCliSource(source),
    sqlNormalized: value.sqlNormalized,
  };
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

type PackagedCliJsonCommandOutput = {
  command?: string;
  data?: unknown;
  error?: {
    detail?: string;
    retryable?: boolean;
    title?: string;
  };
  ok: boolean;
  requestId?: string;
};

function parsePackagedCliJsonCommandOutput(
  stdout: string
): PackagedCliJsonCommandOutput | null {
  if (stdout.length === 0) {
    return null;
  }

  try {
    return JSON.parse(stdout) as PackagedCliJsonCommandOutput;
  } catch {
    return null;
  }
}

function shouldRetryPackagedCliJsonCommand(input: {
  status: number | null;
  stdout: string;
}): boolean {
  const output = parsePackagedCliJsonCommandOutput(input.stdout);
  if (!output || output.ok || output.error?.retryable !== true) {
    return false;
  }

  return output.error.detail?.includes("HTTP error 429") === true;
}

async function runPackagedCliJsonCommandWithRetry(input: {
  args: string[];
  env: Record<string, string>;
  stagedBundleRoot: string;
}): Promise<{
  output: PackagedCliJsonCommandOutput;
  stderr: string;
  stdout: string;
}> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = runPackagedCliCommand(input);
    const parsedOutput = parsePackagedCliJsonCommandOutput(result.stdout);

    if (result.status === 0 && parsedOutput && parsedOutput.ok) {
      return {
        output: parsedOutput,
        stderr: result.stderr,
        stdout: result.stdout,
      };
    }

    if (
      attempt < 2 &&
      shouldRetryPackagedCliJsonCommand({
        status: result.status,
        stdout: result.stdout,
      })
    ) {
      await sleep(1_000 * (attempt + 1));
      continue;
    }

    if (result.status !== 0) {
      throw new Error(
        `CLI command failed (${input.args.join(" ")}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      );
    }

    if (!parsedOutput) {
      throw new Error(
        `CLI command returned invalid JSON (${input.args.join(" ")}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      );
    }

    throw new Error(
      `CLI command reported failure (${input.args.join(" ")}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  throw new Error(`CLI command exceeded retry budget: ${input.args.join(" ")}`);
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
  const result = spawnSync(cliPath, ["--json", ...input.args], {
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

    await sleep(250);
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

    await sleep(250);
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

  const timeoutPromise = sleep(timeoutMs).then(() => {
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

  it("stops the packaged gateway when the pid file is missing but the lock lease remains", async () => {
    const { baseUrl, env, homeDir, port, stagedBundleRoot } =
      await prepareSelfHostRuntime("onequery-cli-missing-gateway-pid-home-");
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
        },
      });

      await waitForBootstrap(baseUrl);
      rmSync(pidPath);

      const statusWhilePidMissing = runPackagedCliJsonCommand({
        args: ["gateway", "status"],
        env,
        stagedBundleRoot,
      });
      expect(statusWhilePidMissing.output).toMatchObject({
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
          stoppedPid: expect.any(Number),
          runtimeState: {
            running: false,
            status: "not_running",
          },
        },
      });

      await waitForGatewayShutdown(baseUrl);
      expect(existsSync(pidPath)).toBe(false);
      expect(existsSync(lockPath)).toBe(false);
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

  it("fails gateway start when another process already listens on the configured port", async () => {
    const { env, homeDir, port, stagedBundleRoot } =
      await prepareSelfHostRuntime("onequery-cli-occupied-gateway-port-home-");
    const pidPath = join(homeDir, "data", "run", "server.pid");
    const lockPath = join(homeDir, "data", "run", "server.lock");
    const logPath = join(homeDir, "data", "logs", "server.log");
    const portBlocker = createServer();

    writeSelfHostConfig(homeDir, port);

    await new Promise<void>((resolve, reject) => {
      portBlocker.once("error", reject);
      portBlocker.listen(port, "127.0.0.1", () => {
        portBlocker.removeListener("error", reject);
        resolve();
      });
    });

    try {
      const start = runPackagedCliCommand({
        args: ["gateway", "start"],
        env,
        stagedBundleRoot,
      });
      const parsedOutput = parsePackagedCliJsonCommandOutput(start.stdout);

      expect(start.status).not.toBe(0);
      expect(parsedOutput).toMatchObject({
        command: "gateway start",
        error: {
          title: "self-host server exited during background start",
        },
        ok: false,
      });
      expect(existsSync(pidPath)).toBe(false);
      expect(existsSync(lockPath)).toBe(false);
      expect(readFileSync(logPath, "utf8")).toContain("EADDRINUSE");
    } finally {
      await new Promise<void>((resolve, reject) => {
        portBlocker.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
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
      const cliConnectClient = createCliConnectClient(baseUrl);
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
      if (!cookieHeader) {
        throw new Error("bootstrap did not return a session cookie");
      }

      expect(bootstrapPayload).toMatchObject({
        bootstrap: {
          organizationSlug: "owner-org",
        },
      });

      const sessionResponse = await callCliConnectRpc({
        cookieHeader,
        call: (options) => cliConnectClient.auth.getSession({}, options),
        requestId: "req_cli_session_123",
      });
      expect(sessionResponse.payload).toMatchObject({
        authMode: AuthMode.BROWSER_SESSION,
        user: {
          email: "owner@example.com",
        },
      });

      const organizationsResponse = await callCliConnectRpc({
        cookieHeader,
        call: (options) =>
          cliConnectClient.organization.listOrganizations(
            {
              page: {
                limit: 1,
              },
            },
            options
          ),
        requestId: "req_cli_orgs_123",
      });
      expect(organizationsResponse.payload).toMatchObject({
        organizations: [{ slug: "owner-org" }],
        page: {
          returnedCount: 1,
        },
      });

      const organizationResponse = await callCliConnectRpc({
        cookieHeader,
        call: (options) =>
          cliConnectClient.organization.getOrganization(
            {
              orgSlug: "owner-org",
            },
            options
          ),
        requestId: "req_cli_org_123",
      });
      expect(organizationResponse.payload).toMatchObject({
        capabilities: expect.arrayContaining([OrgCapability.SOURCE_CONNECT]),
        slug: "owner-org",
      });

      const guideResponse = await callCliConnectRpc({
        cookieHeader,
        call: (options) =>
          cliConnectClient.source.getSourceConnectGuide(
            {
              orgSlug: "owner-org",
              provider: SourceProvider.POSTGRES,
            },
            options
          ),
        requestId: "req_cli_guide_123",
      });
      expect(guideResponse.payload).toMatchObject({
        command: expect.stringContaining(
          "onequery source connect --source postgres"
        ),
        format: ContentFormat.MARKDOWN,
        title: expect.any(String),
      });

      const connectSourceResponse = await callCliConnectRpc({
        cookieHeader,
        call: (options) =>
          cliConnectClient.source.connectSource(
            {
              credentials: {
                kind: {
                  case: "postgres",
                  value: {
                    database: "analytics",
                    host: "localhost",
                    password: "password",
                    port: 5432,
                    sslMode: SourceConnectSslMode.PREFER,
                    username: "postgres",
                  },
                },
              },
              orgSlug: "owner-org",
              sourceKey: "Warehouse",
            },
            options
          ),
        requestId: "req_cli_connect_source_123",
      });
      expect(connectSourceResponse.payload).toMatchObject({
        nextCommand: "onequery source show Warehouse",
        source: {
          sourceKey: "Warehouse",
          provider: SourceProvider.POSTGRES,
          querySupport: SourceQuerySupport.SUPPORTED,
          status: SourceStatus.ACTIVE,
        },
      });

      const sourcesResponse = await callCliConnectRpc({
        cookieHeader,
        call: (options) =>
          cliConnectClient.source.listSources(
            {
              orgSlug: "owner-org",
              page: {
                limit: 1,
              },
            },
            options
          ),
        requestId: "req_cli_sources_123",
      });
      expect(sourcesResponse.payload).toMatchObject({
        sources: [
          {
            sourceKey: "Warehouse",
            status: SourceStatus.ACTIVE,
          },
        ],
        page: {
          returnedCount: 1,
        },
      });

      const sourceResponse = await callCliConnectRpc({
        cookieHeader,
        call: (options) =>
          cliConnectClient.source.getSource(
            {
              orgSlug: "owner-org",
              sourceKey: "Warehouse",
            },
            options
          ),
        requestId: "req_cli_source_123",
      });
      expect(sourceResponse.payload).toMatchObject({
        source: {
          querySupport: SourceQuerySupport.SUPPORTED,
          sourceKey: "Warehouse",
        },
      });

      const validateQueryResponse = await callCliConnectRpc({
        cookieHeader,
        call: (options) =>
          cliConnectClient.query.validateQuery(
            {
              orgSlug: "owner-org",
              query: {
                cellMaxChars: 256,
                maxBytes: 4096,
                maxRows: 100,
                sql: "select 1",
                timeout: durationFromMs(1000),
              },
              sourceKey: "Warehouse",
            },
            options
          ),
        requestId: "req_cli_validate_query_123",
      });
      expect(validateQueryResponse.payload).toMatchObject({
        normalizedSql: expect.any(String),
        source: {
          sourceKey: "Warehouse",
        },
      });

      expect({
        bootstrap: {
          bootstrap: {
            organizationId: "<generated>",
            organizationSlug: bootstrapPayload.bootstrap.organizationSlug,
          },
        },
        bootstrapState: bootstrapStatePayload,
        connectSource: summarizeConnectSourceResponse(
          connectSourceResponse.payload
        ),
        getOrganization: summarizeGetOrganizationResponse(
          organizationResponse.payload
        ),
        getSession: summarizeGetSessionResponse(sessionResponse.payload),
        getSource: summarizeGetSourceResponse(sourceResponse.payload),
        getSourceConnectGuide: summarizeGetSourceConnectGuideResponse(
          guideResponse.payload
        ),
        listOrganizations: summarizeListOrganizationsResponse(
          organizationsResponse.payload
        ),
        listSources: summarizeListSourcesResponse(sourcesResponse.payload),
        validateQuery: summarizeValidateQueryResponse(
          validateQueryResponse.payload
        ),
      }).toMatchSnapshot();
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
      const cliConnectClient = createCliConnectClient(baseUrl);

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
        client: cliConnectClient,
        cookieHeader,
      });
      const cliEnv = {
        ...env,
        ONEQUERY_ACCESS_TOKEN: accessToken,
        ONEQUERY_BASE_URL: baseUrl,
      };

      const whoami = await runPackagedCliJsonCommandWithRetry({
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
        data: {
          user: {
            email: "owner@example.com",
          },
        },
      });

      const authSessionRefresh = await runPackagedCliJsonCommandWithRetry({
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
        data: {
          accessTokenRedacted: true,
        },
      });

      const orgGet = await runPackagedCliJsonCommandWithRetry({
        args: [
          "--org",
          "owner-org",
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
        data: {
          slug: "owner-org",
        },
      });

      const sourceConnect = await runPackagedCliJsonCommandWithRetry({
        args: [
          "--org",
          "owner-org",
          "--request-id",
          "req_cli_cmd_source_connect_123",
          "source",
          "connect",
          "--source",
          "postgres",
          "--input",
          JSON.stringify({
            sourceKey: "warehouse-cli",
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
        data: {
          nextCommand: "onequery source show warehouse-cli",
          source: {
            sourceKey: "warehouse-cli",
            provider: "postgres",
            queryable: true,
            status: "active",
          },
        },
      });

      const sourceList = await runPackagedCliJsonCommandWithRetry({
        args: [
          "--org",
          "owner-org",
          "--request-id",
          "req_cli_cmd_source_list_123",
          "source",
          "list",
          "--fields",
          "sources.sourceKey,sources.status",
          "--page-size",
          "1",
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(sourceList.output).toMatchObject({
        ok: true,
        data: {
          sources: [
            {
              sourceKey: "warehouse-cli",
              status: "active",
            },
          ],
        },
      });

      const sourceShow = await runPackagedCliJsonCommandWithRetry({
        args: [
          "--org",
          "owner-org",
          "--request-id",
          "req_cli_cmd_source_show_123",
          "source",
          "show",
          "warehouse-cli",
          "--fields",
          "sourceKey,queryable",
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(sourceShow.output).toMatchObject({
        ok: true,
        data: {
          sourceKey: "warehouse-cli",
          queryable: true,
        },
      });

      const queryValidate = await runPackagedCliJsonCommandWithRetry({
        args: [
          "--org",
          "owner-org",
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
        data: {
          normalizedSql: expect.any(String),
          source: {
            sourceKey: "warehouse-cli",
          },
        },
      });

      const sourceGuide = await runPackagedCliJsonCommandWithRetry({
        args: [
          "--request-id",
          "req_cli_cmd_source_guide_123",
          "--org",
          "owner-org",
          "source",
          "connect",
          "--source",
          "github",
        ],
        env: cliEnv,
        stagedBundleRoot,
      });
      expect(sourceGuide.output).toMatchObject({
        ok: true,
        data: {
          command: expect.stringContaining(
            "onequery source connect --source github"
          ),
          format: "markdown",
          title: expect.any(String),
        },
      });

      const authSessionRefreshData = authSessionRefresh.output.data as {
        accessTokenRedacted?: boolean;
        activeOrgSlug?: string;
        authMode?: string;
        expiresAt?: string;
        issuedAt?: string;
        user?: {
          displayName?: string;
          email?: string;
          id?: string;
        };
      };

      expect({
        authSessionRefresh: {
          ...authSessionRefresh.output,
          data: {
            ...authSessionRefreshData,
            expiresAt: authSessionRefreshData.expiresAt ? "<timestamp>" : null,
            issuedAt: authSessionRefreshData.issuedAt ? "<timestamp>" : null,
            user: authSessionRefreshData.user
              ? {
                  ...authSessionRefreshData.user,
                  id: "<redacted>",
                }
              : undefined,
          },
        },
        orgGet: orgGet.output,
        queryValidate: queryValidate.output,
        sourceGuide: sourceGuide.output,
        sourceConnect: sourceConnect.output,
        sourceList: sourceList.output,
        sourceShow: sourceShow.output,
        whoami: whoami.output,
      }).toMatchSnapshot();
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
