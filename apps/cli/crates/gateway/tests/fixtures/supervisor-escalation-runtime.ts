import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import {
  RuntimePhase,
  RuntimeStatusSchema,
  RuntimeStopCompletion,
} from "../../../../../../packages/proto-runtime/src/onequery/runtime/v1/common_pb";
import { acquireRuntimeLifecycleLease } from "../../../../../../packages/self-host-runtime/src/self-host/lifecycle";
import type { SelfHostLifecyclePaths } from "../../../../../../packages/self-host-runtime/src/self-host/lifecycle";
import { createSupervisorLifecycleClient } from "../../../../../../packages/self-host-runtime/src/self-host/supervisor-client/client";
import { openSupervisorRuntimeSession } from "../../../../../../packages/self-host-runtime/src/self-host/supervisor-client/session";

const [launchConfigPath, ...argvModes] = process.argv.slice(2);

if (!launchConfigPath) {
  throw new Error(
    "usage: supervisor-escalation-runtime.ts <launch-config-path> [modes...]"
  );
}

const launchConfig = JSON.parse(await readFile(launchConfigPath, "utf8"));
const configModes = Array.isArray(launchConfig.testModes)
  ? launchConfig.testModes.filter(
      (mode: unknown): mode is string => typeof mode === "string"
    )
  : [];
const modeSet = new Set([...configModes, ...argvModes]);
const supervisorControlEndpoint = launchConfig.supervisorControl;

if (supervisorControlEndpoint?.transport?.kind !== "unix") {
  throw new Error(
    "supervisor escalation fixture requires unix supervisorControl"
  );
}

const lifecyclePaths: SelfHostLifecyclePaths = {
  controlEndpoint: supervisorControlEndpoint,
  dataDir: launchConfig.runtimePaths.dataDir,
  lifecycleEventLogPath: launchConfig.runtimePaths.lifecycleEventLogPath,
  logsDir: launchConfig.runtimePaths.logsDir,
  runtimeLeasePath: launchConfig.runtimePaths.runtimeLeasePath,
  runtimeStatusSnapshotPath:
    launchConfig.runtimePaths.runtimeStatusSnapshotPath,
};
const launchSupervisor = launchConfig.supervisor;
if (!launchSupervisor) {
  throw new Error(
    "supervisor escalation fixture requires a launchConfig.supervisor block"
  );
}

const supervisorPid = Number(launchSupervisor.pid);
const supervisorId = launchSupervisor.supervisorId;
const supervisorGeneration = BigInt(launchSupervisor.generation);

await mkdir(dirname(supervisorControlEndpoint.transport.socketPath), {
  mode: 0o700,
  recursive: true,
});

const lease = await acquireRuntimeLifecycleLease(lifecyclePaths, {
  launchId: launchConfig.launchId,
  pid: process.pid,
  supervisor: {
    generation: supervisorGeneration,
    pid: supervisorPid,
    supervisorId,
  },
});
let runtimeSequence = 1n;

const supervisorSession = openSupervisorRuntimeSession({
  client: createSupervisorLifecycleClient({
    endpoint: supervisorControlEndpoint,
  }),
  dataDir: lifecyclePaths.dataDir,
  heartbeatIntervalMs: 50,
  launchId: launchConfig.launchId,
  onStopCommand: async (command) => {
    if (modeSet.has("ignore-graceful-stop")) {
      if (modeSet.has("exit-on-sigterm")) {
        // COMMENT: Bun did not reliably run the SIGTERM handler while this fixture
        // was awaiting an intentionally pending graceful stop; delay the exit so
        // the supervisor observes the terminate phase.
        await new Promise((resolve) => setTimeout(resolve, 250));
        exitSoon(0);
        return;
      }
      return new Promise<void>(() => undefined);
    }

    void lease
      .release({
        reason: command.reason,
        stopServer:
          command.completion === RuntimeStopCompletion.CLEANUP_AND_EXIT,
      })
      .finally(() => {
        exitSoon(0);
      });

    runtimeSequence += 1n;
    return {
      status: runtimeStatus(RuntimePhase.STOPPED),
    };
  },
  runtimePid: process.pid,
  runtimeSequence,
  supervisor: {
    generation: supervisorGeneration,
    pid: supervisorPid,
    supervisorId,
  },
});

let exiting = false;

async function closeAndExit(code: number): Promise<void> {
  if (exiting) {
    return;
  }
  exiting = true;

  try {
    await supervisorSession.close();
  } finally {
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

await lease.transition("ready");
runtimeSequence += 1n;
await supervisorSession.ready(runtimeStatus(RuntimePhase.READY));

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

function runtimeStatus(phase: RuntimePhase) {
  return create(RuntimeStatusSchema, {
    identity: {
      dataDir: lifecyclePaths.dataDir,
      launchId: launchConfig.launchId,
      pid: process.pid,
    },
    phase,
    runtimeSequence,
    updatedAt: timestampFromDate(new Date()),
  });
}
