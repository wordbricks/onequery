import net from "node:net";

import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import type { ServerLaunchSupervisorControlConfig } from "@onequery/config/server-launch";
import { SupervisorLifecycleService } from "@onequery/proto-runtime/runtime/v1/supervisor_pb";
import { TaggedError } from "better-result";

export type SupervisorControlEndpoint = ServerLaunchSupervisorControlConfig;

export class SupervisorLifecycleClientError extends TaggedError(
  "SupervisorLifecycleClientError"
)<{
  cause: unknown;
  message: string;
  socketPath?: string;
}>() {}

export function createSupervisorLifecycleClient(input: {
  endpoint: SupervisorControlEndpoint;
}) {
  const { transport } = input.endpoint;
  if (transport?.kind.case !== "unix") {
    throw new SupervisorLifecycleClientError({
      cause: null,
      message: `unsupported supervisor control transport ${transport?.kind.case}`,
    });
  }

  const socketPath = transport.kind.value.socketPath;

  return createClient(
    SupervisorLifecycleService,
    createConnectTransport({
      baseUrl: input.endpoint.baseUrl,
      httpVersion: "2",
      nodeOptions: {
        createConnection: () => net.connect(socketPath),
      },
      readMaxBytes: input.endpoint.maxMessageBytes,
      writeMaxBytes: input.endpoint.maxMessageBytes,
    })
  );
}

export type SupervisorLifecycleClient = ReturnType<
  typeof createSupervisorLifecycleClient
>;
