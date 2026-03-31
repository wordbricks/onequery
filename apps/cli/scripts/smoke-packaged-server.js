#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import { access, cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "../../../packages/dev-config/src/master-encryption-key.ts";
import {
  CLI_BINARY_NAME,
  CLI_SERVER_BINARY_NAME,
  binaryNameForTargetTriple,
} from "../bin/package-constants.js";

const SMOKE_PACKAGED_SERVER_OPTIONS = new Set([
  "--help",
  "-h",
  "--platform-tarball",
  "--port",
  "--root-tarball",
  "--target-triple",
]);

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (
    value === undefined ||
    value.length === 0 ||
    SMOKE_PACKAGED_SERVER_OPTIONS.has(value)
  ) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

export function parseArgs(argv) {
  const args = {
    platformTarball: null,
    port: null,
    rootTarball: null,
    targetTriple: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--platform-tarball": {
        args.platformTarball = path.resolve(
          readOptionValue(argv, index, argument)
        );
        index += 1;
        break;
      }
      case "--port": {
        args.port = Number.parseInt(readOptionValue(argv, index, argument), 10);
        index += 1;
        break;
      }
      case "--root-tarball": {
        args.rootTarball = path.resolve(readOptionValue(argv, index, argument));
        index += 1;
        break;
      }
      case "--target-triple": {
        args.targetTriple = readOptionValue(argv, index, argument);
        index += 1;
        break;
      }
      case "--help":
      case "-h": {
        printHelp();
        process.exit(0);
        return args;
      }
      default: {
        throw new Error(`Unknown argument '${argument}'.`);
      }
    }
  }

  if (!args.rootTarball) {
    throw new Error("--root-tarball is required.");
  }

  if (!args.platformTarball) {
    throw new Error("--platform-tarball is required.");
  }

  if (!args.targetTriple) {
    throw new Error("--target-triple is required.");
  }

  if (args.port !== null && (!Number.isInteger(args.port) || args.port <= 0)) {
    throw new Error(`Invalid --port value '${args.port}'.`);
  }

  return args;
}

export async function smokePackagedServer({
  platformTarball,
  port,
  rootTarball,
  targetTriple,
}) {
  const resolvedPort = port ?? (await reserveFreePort());
  const workspace = await mkdtemp(
    path.join(tmpdir(), "onequery-packaged-server-smoke-")
  );
  const rootExtractDir = path.join(workspace, "root");
  const platformExtractDir = path.join(workspace, "platform");
  const runtimeRoot = path.join(rootExtractDir, "package");
  const launcherPath = path.join(runtimeRoot, "bin", "onequery.js");
  const platformVendorRoot = path.join(platformExtractDir, "package", "vendor");
  const packagedServerExecutableName = binaryNameForTargetTriple(
    targetTriple,
    CLI_SERVER_BINARY_NAME
  );
  const packagedCliExecutableName = binaryNameForTargetTriple(
    targetTriple,
    CLI_BINARY_NAME
  );
  const packagedServerExecutable = path.join(
    runtimeRoot,
    "vendor",
    targetTriple,
    "server",
    packagedServerExecutableName
  );
  const packagedCliExecutable = path.join(
    platformExtractDir,
    "package",
    "vendor",
    targetTriple,
    "onequery",
    packagedCliExecutableName
  );

  try {
    await mkdir(rootExtractDir, { recursive: true });
    await mkdir(platformExtractDir, { recursive: true });

    extractTarball(rootTarball, rootExtractDir);
    extractTarball(platformTarball, platformExtractDir);
    await Promise.all([
      access(runtimeRoot),
      access(launcherPath),
      access(platformVendorRoot),
      access(packagedCliExecutable),
    ]);
    await cp(platformVendorRoot, path.join(runtimeRoot, "vendor"), {
      recursive: true,
    });
    await access(packagedServerExecutable);

    const dataDir = path.join(workspace, "data");
    const configDir = path.join(workspace, "config");
    await Promise.all([
      mkdir(dataDir, { recursive: true }),
      mkdir(configDir, { recursive: true }),
    ]);

    const publicOrigin = `http://127.0.0.1:${resolvedPort}`;
    const env = {
      ...process.env,
      BETTER_AUTH_SECRET: "test-better-auth-secret",
      HOST: "127.0.0.1",
      MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
      ONEQUERY_PUBLIC_ORIGIN: publicOrigin,
      ONEQUERY_SELF_HOST_CONFIG_DIR: configDir,
      ONEQUERY_SELF_HOST_DATA_DIR: dataDir,
      PORT: String(resolvedPort),
    };
    delete env.ONEQUERY_NPM_ROOT;
    delete env.ONEQUERY_PGLITE_ASSET_DIR;
    delete env.ONEQUERY_RUNTIME_ROOT;
    delete env.ONEQUERY_SERVER_EXECUTABLE;

    const child = spawn(...launcherInvocation(launcherPath, ["serve"]), {
      cwd: runtimeRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const outputChunks = [];
    let spawnError = null;
    child.stdout?.on("data", (chunk) => {
      outputChunks.push(chunk.toString());
    });
    child.stderr?.on("data", (chunk) => {
      outputChunks.push(chunk.toString());
    });
    child.once("error", (error) => {
      spawnError = error;
    });

    let runtimeStarted = false;
    try {
      await waitForHealthyResponse({
        child,
        outputChunks,
        spawnError: () => spawnError,
        url: `${publicOrigin}/`,
      });
      runtimeStarted = true;
    } finally {
      if (runtimeStarted) {
        stopPackagedRuntime({
          env,
          launcherPath,
          runtimeRoot,
        });
        await waitForServerShutdown(`${publicOrigin}/`);
      }
      await terminateChildProcess(child);
    }
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

async function waitForHealthyResponse({
  child,
  outputChunks,
  spawnError,
  url,
}) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const childSpawnError = spawnError();
    if (childSpawnError) {
      throw childSpawnError;
    }

    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(renderServerFailure(outputChunks, child.exitCode));
    }

    let response;
    try {
      response = await fetch(url);
    } catch {
      await delay(250);
      continue;
    }

    if (!response.ok) {
      throw new Error(`expected 2xx from ${url}, received ${response.status}`);
    }

    const body = await response.text();
    if (!body.toLowerCase().includes("<!doctype html")) {
      throw new Error(
        `expected packaged web assets at ${url}, but the response did not contain an HTML document`
      );
    }

    return;
  }

  throw new Error(
    `timed out waiting for packaged self-host server at ${url}\n${outputChunks.join("").trim()}`
  );
}

function renderServerFailure(outputChunks, exitCode) {
  const output = outputChunks.join("").trim();
  if (output.length === 0) {
    return `packaged self-host server exited with code ${exitCode}`;
  }

  return `packaged self-host server exited with code ${exitCode}\n${output}`;
}

function stopPackagedRuntime({ env, launcherPath, runtimeRoot }) {
  const [command, args] = launcherInvocation(launcherPath, ["serve", "stop"]);
  const result = spawnSync(command, args, {
    cwd: runtimeRoot,
    encoding: "utf8",
    env,
  });
  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join("\n")
      .trim();
    const message =
      output.length > 0
        ? `failed to stop packaged self-host server\n${output}`
        : "failed to stop packaged self-host server";

    throw new Error(message);
  }
}

function launcherInvocation(launcherPath, args) {
  if (process.platform === "win32") {
    // COMMENT: npm installs provide a `.cmd` shim on Windows, but the tarball
    // smoke test only has the raw JS entrypoint. Re-run it through Bun there.
    return [process.execPath, [launcherPath, ...args]];
  }

  return [launcherPath, args];
}

async function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("failed to determine a free localhost port"));
        });
        return;
      }

      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function terminateChildProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill("SIGINT");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (child.exitCode !== null) {
      return;
    }
    await delay(100);
  }

  child.kill("SIGKILL");
}

async function waitForServerShutdown(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(url);
    } catch {
      return;
    }

    await delay(250);
  }

  throw new Error(
    `timed out waiting for packaged self-host server to stop at ${url}`
  );
}

function extractTarball(tarballPath, destinationDir) {
  const result = spawnSync("tar", ["-xzf", tarballPath, "-C", destinationDir], {
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join("\n")
      .trim();
    const message =
      output.length > 0
        ? `failed to extract ${tarballPath}\n${output}`
        : `failed to extract ${tarballPath}`;

    throw new Error(message);
  }
}

function printHelp() {
  console.log(`Usage: bun apps/cli/scripts/smoke-packaged-server.js --root-tarball <path> --platform-tarball <path> --target-triple <target> [options]

Options:
  --port <number>       Port to use for the smoke server (default: auto)
`);
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  await smokePackagedServer(args);
}
