import { chmod, mkdir, rm } from "node:fs/promises";
import http2 from "node:http2";
import { dirname } from "node:path";

import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouterOptions, ServiceImpl } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { createValidateInterceptor } from "@connectrpc/validate";
import { RuntimeControlService } from "@onequery/proto-runtime/runtime/v1/control_pb";
import { TaggedError } from "better-result";

import type { RuntimeControlEndpoint } from "../lifecycle/types";
import type { RuntimeControlActor } from "./actor";

export class RuntimeControlServerError extends TaggedError(
  "RuntimeControlServerError"
)<{
  cause: unknown;
  message: string;
  socketPath: string;
}>() {}

export interface RuntimeControlServer {
  close(): Promise<void>;
  name: "runtime-control";
  socketPath: string;
}

export const RUNTIME_CONTROL_CONNECT_MAX_MESSAGE_BYTES = 64 * 1024;
export const RUNTIME_CONTROL_CONNECT_MAX_TIMEOUT_MS = 300_000;

const runtimeControlConnectRouterOptions = {
  connect: true,
  grpc: false,
  grpcWeb: false,
  interceptors: [createValidateInterceptor()],
  maxTimeoutMs: RUNTIME_CONTROL_CONNECT_MAX_TIMEOUT_MS,
  readMaxBytes: RUNTIME_CONTROL_CONNECT_MAX_MESSAGE_BYTES,
  requireConnectProtocolHeader: true,
  writeMaxBytes: RUNTIME_CONTROL_CONNECT_MAX_MESSAGE_BYTES,
} satisfies Pick<
  ConnectRouterOptions,
  | "connect"
  | "grpc"
  | "grpcWeb"
  | "interceptors"
  | "maxTimeoutMs"
  | "readMaxBytes"
  | "requireConnectProtocolHeader"
  | "writeMaxBytes"
>;

const RUNTIME_CONTROL_SESSION_CLOSE_GRACE_MS = 250;

export async function serveRuntimeControl(input: {
  actor: RuntimeControlActor;
  endpoint: RuntimeControlEndpoint;
}): Promise<RuntimeControlServer> {
  switch (input.endpoint.transport) {
    case "unix":
      return serveUnixRuntimeControl(input.actor, input.endpoint.socketPath);
    default:
      throw new RuntimeControlServerError({
        cause: null,
        message: "unsupported runtime control transport",
        socketPath: input.endpoint.socketPath,
      });
  }
}

function createRuntimeControlConnectHandler(
  actor: RuntimeControlActor,
  shutdownSignal: AbortSignal
) {
  const implementation: ServiceImpl<typeof RuntimeControlService> = {
    async getStatus() {
      return {
        status: await actor.getStatus(),
      };
    },
    async stop(request) {
      return actor.stop(request);
    },
    watchStatus(request, context) {
      return actor.watchStatus(request, context.signal);
    },
  };

  return connectNodeAdapter({
    ...runtimeControlConnectRouterOptions,
    shutdownSignal,
    routes(router) {
      router.service(RuntimeControlService, implementation);
    },
  });
}

async function serveUnixRuntimeControl(
  actor: RuntimeControlActor,
  socketPath: string
): Promise<RuntimeControlServer> {
  await mkdir(dirname(socketPath), {
    recursive: true,
    mode: 0o700,
  });
  await rm(socketPath, {
    force: true,
  });

  const sessions = new Set<http2.ServerHttp2Session>();
  const shutdownController = new AbortController();
  const server = http2.createServer(
    createRuntimeControlConnectHandler(actor, shutdownController.signal)
  );
  server.on("session", (session) => {
    sessions.add(session);
    session.once("close", () => {
      sessions.delete(session);
    });
  });

  await listen(server, socketPath);
  await chmod(socketPath, 0o600);

  let closed = false;
  return {
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      shutdownController.abort(
        new ConnectError(
          "runtime control server shutting down",
          Code.Unavailable
        )
      );
      for (const session of sessions) {
        session.close();
      }

      const destroyTimer = setTimeout(() => {
        for (const session of sessions) {
          session.destroy();
        }
      }, RUNTIME_CONTROL_SESSION_CLOSE_GRACE_MS);
      destroyTimer.unref();
      try {
        await closeServer(server, socketPath);
      } finally {
        clearTimeout(destroyTimer);
        for (const session of sessions) {
          session.destroy();
        }
      }
      await rm(socketPath, {
        force: true,
      });
    },
    name: "runtime-control",
    socketPath,
  };
}

function listen(server: http2.Http2Server, socketPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handleError = (cause: unknown) => {
      cleanup();
      reject(
        new RuntimeControlServerError({
          cause,
          message: `failed to listen on runtime control socket ${socketPath}`,
          socketPath,
        })
      );
    };
    const handleListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off("error", handleError);
      server.off("listening", handleListening);
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(socketPath);
  });
}

function closeServer(
  server: http2.Http2Server,
  socketPath: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((cause) => {
      if (cause) {
        reject(
          new RuntimeControlServerError({
            cause,
            message: `failed to close runtime control socket ${socketPath}`,
            socketPath,
          })
        );
        return;
      }

      resolve();
    });
  });
}
