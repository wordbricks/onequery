import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  decodeServerLaunchConfigJson,
  viewServerLaunchConfig,
} from "@onequery/config/server-launch";

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

const launchConfig = decodeServerLaunchConfigJson(
  await readFile(launchConfigPath, "utf8"),
  launchConfigPath
);
const launchView = viewServerLaunchConfig(launchConfig, launchConfigPath);
if (launchView.mode !== "self-host") {
  throw new Error(
    "supervisor escalation fixture requires selfHost launch config"
  );
}

const modeSet = new Set(argvModes);
const supervisorControlEndpoint = launchView.supervisorControl;
const supervisorControlTransport = supervisorControlEndpoint.transport?.kind;

if (supervisorControlTransport?.case !== "unix") {
  throw new Error(
    "supervisor escalation fixture requires unix supervisorControl"
  );
}

const socketPath = supervisorControlTransport.value.socketPath;
const lifecyclePaths: SelfHostLifecyclePaths = {
  controlEndpoint: supervisorControlEndpoint,
  dataDir: launchView.runtimePaths.dataDir,
  lifecycleEventLogPath: launchView.runtimePaths.lifecycleEventLogPath,
  logsDir: launchView.runtimePaths.logsDir,
  runtimeLeasePath: launchView.runtimePaths.runtimeLeasePath,
  runtimeStatusSnapshotPath: launchView.runtimePaths.runtimeStatusSnapshotPath,
};
const launchId = launchView.launchId;
const launchSupervisor = launchView.supervisor;

await mkdir(dirname(socketPath), {
  mode: 0o700,
  recursive: true,
});

const lease = await acquireRuntimeLifecycleLease(lifecyclePaths, {
  launchId,
  pid: process.pid,
  supervisor: launchSupervisor,
});
let runtimeSequence = 1n;

const supervisorSession = openSupervisorRuntimeSession({
  client: createSupervisorLifecycleClient({
    endpoint: lifecyclePaths.controlEndpoint,
  }),
  dataDir: lifecyclePaths.dataDir,
  heartbeatIntervalMs: 50,
  launchId,
  onStopCommand: async (command) => {
    if (modeSet.has("ignore-graceful-stop")) {
      if (modeSet.has("exit-on-sigterm")) {
        // COMMENT: Bun did not reliably run the SIGTERM handler while this fixture
        // was awaiting an intentionally pending graceful stop. Force the fixture
        // process out after the supervisor has time to observe the terminate phase;
        // graceful session cleanup can outlive the test terminate deadline.
        await new Promise((resolve) => {
          setTimeout(resolve, 250);
        });
        forceExitSoon(0);
      }
      return new Promise<never>(() => undefined);
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
  supervisor: launchSupervisor,
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

function forceExitSoon(code: number): void {
  if (exiting) {
    return;
  }
  exiting = true;
  setTimeout(() => {
    process.exit(code);
  }, 25);
}

if (modeSet.has("ignore-sigterm")) {
  process.on("SIGTERM", () => undefined);
} else if (modeSet.has("exit-on-sigterm")) {
  process.on("SIGTERM", () => {
    forceExitSoon(0);
  });
}

process.on("SIGINT", () => {
  exitSoon(0);
});

const readyDelayArg = argvModes.find((mode) =>
  mode.startsWith("--ready-delay-ms=")
);
const readyDelayMs = Number(
  readyDelayArg?.slice("--ready-delay-ms=".length) ?? 0
);
if (Number.isFinite(readyDelayMs) && readyDelayMs > 0) {
  await new Promise((resolve) => {
    setTimeout(resolve, readyDelayMs);
  });
}

await lease.transition(RuntimePhase.READY);
runtimeSequence += 1n;
await supervisorSession.ready(runtimeStatus(RuntimePhase.READY));

if (modeSet.has("exit-after-ready")) {
  const exitDelayArg = argvModes.find((mode) =>
    mode.startsWith("--exit-after-ready-delay-ms=")
  );
  const exitDelayMs = Number(
    exitDelayArg?.slice("--exit-after-ready-delay-ms=".length) ?? 150
  );
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
      launchId,
      pid: process.pid,
    },
    phase,
    runtimeSequence,
    updatedAt: timestampFromDate(new Date()),
  });
}
