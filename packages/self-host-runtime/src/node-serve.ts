import { createAdaptorServer } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { oneshot } from "antiox/sync/oneshot";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

import type { StartServerDependencies } from "./index";

type NodeServeOptions = Parameters<StartServerDependencies["serve"]>[0];

type ResolvedNodeAddress = {
  hostname: string;
  port: number;
};

export class NodeServerListenError extends TaggedError(
  "NodeServerListenError"
)<{
  cause: unknown;
  hostname: string;
  message: string;
  port: number;
}>() {}

export class NodeServerStopError extends TaggedError("NodeServerStopError")<{
  cause: unknown;
  hostname: string;
  message: string;
  port: number;
}>() {}

export type ServeWithNodeError = NodeServerListenError;

export type ServeWithNodeResult = ResultType<
  Awaited<ReturnType<StartServerDependencies["serve"]>>,
  ServeWithNodeError
>;

export async function serveWithNodeResult(
  options: NodeServeOptions
): Promise<ServeWithNodeResult> {
  const server = createAdaptorServer({
    autoCleanupIncoming: true,
    fetch: options.fetch,
    hostname: options.hostname,
    overrideGlobalObjects: false,
  });

  if ("keepAliveTimeout" in server) {
    server.keepAliveTimeout = options.idleTimeout * 1000;
  }

  const listenResult = await listen(server, options);
  if (listenResult.isErr()) {
    return Result.err(listenResult.error);
  }

  const address = server.address();
  const resolvedAddress =
    address && typeof address === "object"
      ? {
          hostname: address.address ?? options.hostname,
          port: address.port ?? options.port,
        }
      : {
          hostname: options.hostname,
          port: options.port,
        };

  return Result.ok({
    hostname: resolvedAddress.hostname,
    port: resolvedAddress.port,
    stop(closeActiveConnections) {
      return stopNodeServer(server, resolvedAddress, closeActiveConnections);
    },
  });
}

export async function serveWithNode(
  options: NodeServeOptions
): Promise<Awaited<ReturnType<StartServerDependencies["serve"]>>> {
  const startedServer = await serveWithNodeResult(options);

  if (startedServer.isErr()) {
    throw startedServer.error;
  }

  return startedServer.value;
}

async function listen(
  server: ServerType,
  options: Pick<NodeServeOptions, "hostname" | "port">
): Promise<ResultType<void, NodeServerListenError>> {
  const [readyTx, readyRx] = oneshot<ResultType<void, NodeServerListenError>>();
  const completeListen = (result: ResultType<void, NodeServerListenError>) => {
    server.off("listening", handleListening);
    server.off("error", handleError);
    Result.try(() => readyTx.send(result));
  };
  const handleListening = () => {
    completeListen(Result.ok(undefined));
  };
  const handleError = (cause: unknown) => {
    completeListen(
      Result.err(
        new NodeServerListenError({
          cause,
          hostname: options.hostname,
          message: `Failed to start self-host runtime on ${options.hostname}:${options.port}`,
          port: options.port,
        })
      )
    );
  };

  server.once("listening", handleListening);
  server.once("error", handleError);

  const startListenResult = Result.try({
    try: () => {
      server.listen(options.port, options.hostname);
    },
    catch: (cause) =>
      new NodeServerListenError({
        cause,
        hostname: options.hostname,
        message: `Failed to bind self-host runtime to ${options.hostname}:${options.port}`,
        port: options.port,
      }),
  });
  if (startListenResult.isErr()) {
    server.off("listening", handleListening);
    server.off("error", handleError);
    return Result.err(startListenResult.error);
  }

  const readyResult = await Result.tryPromise({
    try: async () => readyRx,
    catch: (cause) =>
      new NodeServerListenError({
        cause,
        hostname: options.hostname,
        message: `Failed to observe self-host runtime startup on ${options.hostname}:${options.port}`,
        port: options.port,
      }),
  });
  if (readyResult.isErr()) {
    server.close();
    return Result.err(readyResult.error);
  }

  return Result.ok(undefined);
}

async function stopNodeServer(
  server: ServerType,
  address: ResolvedNodeAddress,
  closeActiveConnections?: boolean
): Promise<void> {
  const stopResult = await stopNodeServerResult(
    server,
    address,
    closeActiveConnections
  );

  if (stopResult.isErr()) {
    throw stopResult.error;
  }
}

async function stopNodeServerResult(
  server: ServerType,
  address: ResolvedNodeAddress,
  closeActiveConnections?: boolean
): Promise<ResultType<void, NodeServerStopError>> {
  const [stopTx, stopRx] = oneshot<ResultType<void, NodeServerStopError>>();

  const startStopResult = Result.try({
    try: () => {
      server.close((error) => {
        const completion =
          error === undefined
            ? Result.ok<void, NodeServerStopError>(undefined)
            : Result.err(
                new NodeServerStopError({
                  cause: error,
                  hostname: address.hostname,
                  message: `Failed to stop self-host runtime on ${address.hostname}:${address.port}`,
                  port: address.port,
                })
              );

        Result.try(() => stopTx.send(completion));
      });

      if (closeActiveConnections) {
        if ("closeAllConnections" in server) {
          server.closeAllConnections?.();
        }
        if ("closeIdleConnections" in server) {
          server.closeIdleConnections?.();
        }
      }
    },
    catch: (cause) =>
      new NodeServerStopError({
        cause,
        hostname: address.hostname,
        message: `Failed to stop self-host runtime on ${address.hostname}:${address.port}`,
        port: address.port,
      }),
  });
  if (startStopResult.isErr()) {
    return Result.err(startStopResult.error);
  }

  const completionResult = await Result.tryPromise({
    try: async () => stopRx,
    catch: (cause) =>
      new NodeServerStopError({
        cause,
        hostname: address.hostname,
        message: `Failed to observe self-host runtime shutdown on ${address.hostname}:${address.port}`,
        port: address.port,
      }),
  });
  if (completionResult.isErr()) {
    return Result.err(completionResult.error);
  }

  return completionResult.value;
}
