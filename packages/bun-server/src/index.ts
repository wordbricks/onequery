import { app } from "./app";
import { DEFAULT_BUN_SERVER_IDLE_TIMEOUT_SECONDS } from "./constants";
import { prepareRuntimeDatabase } from "./database";
import { createRuntimeConfig } from "./runtime-env";
import {
  acquireRuntimeLifecycleLease,
  appendLifecycleLog,
  attachGracefulShutdownHandlers,
} from "./self-host/lifecycle";
import { resolveSelfHostRuntimePaths } from "./self-host/paths";

const selfHostPaths = resolveSelfHostRuntimePaths(process.env);
const lifecycleLogWriter = {
  append(message: string) {
    return appendLifecycleLog(selfHostPaths, message);
  },
};
const lifecycleLease = await acquireRuntimeLifecycleLease(selfHostPaths, {
  logWriter: lifecycleLogWriter,
});

try {
  const runtimeConfig = createRuntimeConfig({ selfHostPaths });
  // Comment: The Bun runtime is the single owner of main application schema
  // convergence; local bootstrap only guarantees the shared Postgres container.
  await prepareRuntimeDatabase({
    databaseUrl: runtimeConfig.env.DATABASE_URL ?? "",
    rootDir: process.env.ONEQUERY_RUNTIME_ROOT ?? process.cwd(),
  });
  const { listenHost: hostname, port } = runtimeConfig;

  const server = Bun.serve({
    fetch(request) {
      return app.fetch(request, runtimeConfig.env);
    },
    hostname,
    idleTimeout: DEFAULT_BUN_SERVER_IDLE_TIMEOUT_SECONDS,
    port,
  });

  const listenAddress = `http://${server.hostname}:${server.port}`;

  attachGracefulShutdownHandlers({
    lease: lifecycleLease,
    logWriter: lifecycleLogWriter,
    server,
  });

  await lifecycleLogWriter.append(`[bun-server] listening on ${listenAddress}`);
  console.log(`[bun-server] listening on ${listenAddress}`);
} catch (error) {
  await lifecycleLease.release({
    reason: "startup_failure",
    stopServer: false,
  });
  throw error;
}
