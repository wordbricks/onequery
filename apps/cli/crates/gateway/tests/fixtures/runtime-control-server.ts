import { writeFile } from "node:fs/promises";

import {
  createRuntimeControlActor,
  serveRuntimeControl,
} from "../../../../../../packages/self-host-runtime/src/self-host/runtime-control";

const [socketPath, readyPath, mode] = process.argv.slice(2);

if (!socketPath || !readyPath) {
  throw new Error(
    "usage: runtime-control-server.ts <socket-path> <ready-path>"
  );
}

const lease = {
  paths: {
    controlEndpoint: {
      socketPath,
      transport: "unix" as const,
    },
    dataDir: "/tmp/onequery-data",
    logsDir: "/tmp/onequery-logs",
    runtimeLeasePath: "/tmp/onequery-run/runtime.lease.json",
    runtimeStatusSnapshotPath: "/tmp/onequery-run/runtime.status.json",
  },
  release: async () => undefined,
  transition: async () => undefined,
};

const actor = createRuntimeControlActor({
  identity: {
    dataDir: "/tmp/onequery-data",
    launchId: "launch-rust-connect-unix",
    pid: 4242,
  },
  lease,
  now: () => new Date("2026-04-27T00:00:00.000Z"),
});
actor.attachShutdownController({
  dispose: () => undefined,
  shutdown: async (reason, completion = "cleanup_only") => {
    await actor.lease.release({
      reason,
      stopServer: completion === "cleanup_and_exit",
    });
  },
});
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

if (mode === "transition-ready") {
  await actor.lease.transition("ready");
}
await writeFile(readyPath, "ready\n");
await new Promise(() => undefined);
