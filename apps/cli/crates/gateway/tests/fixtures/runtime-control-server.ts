import { writeFile } from "node:fs/promises";

import {
  createRuntimeControlActor,
  serveRuntimeControl,
} from "../../../../../../packages/self-host-runtime/src/self-host/runtime-control";

const [socketPath, readyPath] = process.argv.slice(2);

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
    lockPath: "/tmp/onequery-run/server.lock",
    logsDir: "/tmp/onequery-logs",
    pidPath: "/tmp/onequery-run/server.pid",
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

await writeFile(readyPath, "ready\n");
await new Promise(() => undefined);
