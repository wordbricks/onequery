import { writeFile } from "node:fs/promises";

import {
  createRuntimeControlActor,
  serveRuntimeControl,
} from "../../../../../../packages/self-host-runtime/src/self-host/runtime-control";

const [socketPath, readyPath, ...modes] = process.argv.slice(2);
const modeSet = new Set(modes);

if (!socketPath || !readyPath) {
  throw new Error(
    "usage: runtime-control-server.ts <socket-path> <ready-path> [modes...]"
  );
}

const lease = {
  paths: {
    controlEndpoint: {
      transport: {
        kind: "unix" as const,
        socketPath,
      },
    },
    dataDir: "/tmp/onequery-data",
    lifecycleEventLogPath: "/tmp/onequery-run/lifecycle.events.pb",
    logsDir: "/tmp/onequery-logs",
    runtimeLeasePath: "/tmp/onequery-run/runtime.lease.json",
    runtimeStatusSnapshotPath: "/tmp/onequery-run/runtime.status.json",
  },
  persistTransition: async () => undefined,
  release: async () => undefined,
  transition: async () => undefined,
};

const actor = createRuntimeControlActor({
  identity: {
    dataDir: "/tmp/onequery-data",
    launchId: "launch-rust-connect-unix",
    pid: 4242,
    supervisor: {
      generation: 7n,
      pid: 1001,
      supervisorId: "gateway-supervisor-test",
    },
  },
  lease,
  now: () => new Date("2026-04-27T00:00:00.000Z"),
});
if (!modeSet.has("without-shutdown-controller")) {
  actor.attachShutdownController({
    dispose: () => undefined,
    shutdown: async (request) => {
      await actor.lease.release({
        reason: request.reason,
        stopServer: request.completion === "cleanup_and_exit",
      });
    },
  });
}
const server = await serveRuntimeControl({
  actor,
  endpoint: lease.paths.controlEndpoint,
});

let closed = false;

async function close(): Promise<void> {
  if (closed) {
    return;
  }

  closed = true;
  await server.close();
  actor.dispose();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void close().finally(() => {
      process.exit(0);
    });
  });
}

if (modeSet.has("transition-ready")) {
  await actor.lease.transition("ready");
}
await writeFile(readyPath, "ready\n");
await new Promise(() => undefined);
