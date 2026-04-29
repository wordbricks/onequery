import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { acquireRuntimeLifecycleLease } from "../../../../../../packages/self-host-runtime/src/self-host/lifecycle";
import type { SelfHostLifecyclePaths } from "../../../../../../packages/self-host-runtime/src/self-host/lifecycle";
import {
  createRuntimeControlActor,
  serveRuntimeControl,
} from "../../../../../../packages/self-host-runtime/src/self-host/runtime-control";

const [
  launchConfigPath,
  supervisorPidRaw,
  supervisorIdRaw,
  supervisorGenerationRaw,
  ...argvModes
] = process.argv.slice(2);

if (!launchConfigPath) {
  throw new Error(
    "usage: supervisor-escalation-runtime.ts <launch-config-path> [<supervisor-pid> <supervisor-id> <supervisor-generation>] [modes...]"
  );
}

const launchConfig = JSON.parse(await readFile(launchConfigPath, "utf8"));
const configModes = Array.isArray(launchConfig.testModes)
  ? launchConfig.testModes.filter(
      (mode: unknown): mode is string => typeof mode === "string"
    )
  : [];
const modeSet = new Set([...configModes, ...argvModes]);
const socketPath = launchConfig.runtimeControl?.transport?.socketPath;

if (launchConfig.runtimeControl?.transport?.kind !== "unix" || !socketPath) {
  throw new Error("supervisor escalation fixture requires unix runtimeControl");
}

if (
  (supervisorPidRaw || supervisorIdRaw || supervisorGenerationRaw) &&
  (!supervisorPidRaw || !supervisorIdRaw || !supervisorGenerationRaw)
) {
  throw new Error(
    "supervisor escalation fixture requires supervisor pid, id, and generation when supervisor identity arguments are provided"
  );
}

const lifecyclePaths: SelfHostLifecyclePaths = {
  controlEndpoint: launchConfig.runtimeControl,
  dataDir: launchConfig.runtimePaths.dataDir,
  lifecycleEventLogPath: launchConfig.runtimePaths.lifecycleEventLogPath,
  logsDir: launchConfig.runtimePaths.logsDir,
  runtimeLeasePath: launchConfig.runtimePaths.runtimeLeasePath,
  runtimeStatusSnapshotPath:
    launchConfig.runtimePaths.runtimeStatusSnapshotPath,
};
const supervisorPid = supervisorPidRaw
  ? Number(supervisorPidRaw)
  : process.ppid;
const supervisorId = supervisorIdRaw ?? `gateway-supervisor:${supervisorPid}`;
const supervisorGeneration = BigInt(supervisorGenerationRaw ?? "1");

await mkdir(dirname(socketPath), { mode: 0o700, recursive: true });

const lease = await acquireRuntimeLifecycleLease(lifecyclePaths, {
  launchId: launchConfig.launchId,
  pid: process.pid,
  supervisor: {
    generation: supervisorGeneration,
    pid: supervisorPid,
    supervisorId,
  },
});
const actor = createRuntimeControlActor({
  identity: {
    dataDir: lifecyclePaths.dataDir,
    launchId: launchConfig.launchId,
    pid: process.pid,
    supervisorGeneration,
    supervisorPid,
  },
  lease,
});
const server = await serveRuntimeControl({
  actor,
  endpoint: lifecyclePaths.controlEndpoint,
});

let exiting = false;

async function closeAndExit(code: number): Promise<void> {
  if (exiting) {
    return;
  }
  exiting = true;

  try {
    await server.close();
  } finally {
    actor.dispose();
    process.exit(code);
  }
}

function exitSoon(code: number): void {
  if (exiting) {
    return;
  }
  setTimeout(() => {
    void closeAndExit(code);
  }, 25);
}

actor.attachShutdownController({
  dispose: () => undefined,
  shutdown: async (request) => {
    if (modeSet.has("ignore-graceful-stop")) {
      return new Promise<void>(() => undefined);
    }

    void actor.lease
      .release({
        reason: request.reason,
        stopServer: request.completion === "cleanup_and_exit",
      })
      .finally(() => {
        exitSoon(0);
      });
  },
});

if (modeSet.has("ignore-sigterm")) {
  process.on("SIGTERM", () => undefined);
} else if (modeSet.has("exit-on-sigterm")) {
  process.on("SIGTERM", () => {
    exitSoon(0);
  });
}

process.on("SIGINT", () => {
  exitSoon(0);
});

const readyDelayMs = Number(launchConfig.testReadyDelayMs ?? 0);
if (Number.isFinite(readyDelayMs) && readyDelayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, readyDelayMs));
}

await actor.lease.transition("ready");

if (modeSet.has("exit-after-ready")) {
  const exitDelayMs = Number(launchConfig.testExitAfterReadyDelayMs ?? 150);
  setTimeout(
    () => {
      void closeAndExit(0);
    },
    Number.isFinite(exitDelayMs) && exitDelayMs >= 0 ? exitDelayMs : 150
  );
}

await new Promise<void>(() => undefined);
