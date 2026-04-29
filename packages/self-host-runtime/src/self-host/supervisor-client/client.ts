import net from "node:net";

import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { SupervisorLifecycleService } from "@onequery/proto-runtime/runtime/v1/supervisor_pb";
import { TaggedError } from "better-result";

export type SupervisorControlEndpoint = NonNullable<
  ServerLaunchConfig["supervisorControl"]
>;

export class SupervisorLifecycleClientError extends TaggedError(
  "SupervisorLifecycleClientError"
)<{
  cause: unknown;
  message: string;
  socketPath?: string;
}>() {}

export const SUPERVISOR_LIFECYCLE_CONNECT_BASE_URL =
  "http://onequery-supervisor";
export const SUPERVISOR_LIFECYCLE_CONNECT_MAX_MESSAGE_BYTES = 64 * 1024;
export const SUPERVISOR_LIFECYCLE_CONNECT_MAX_TIMEOUT_MS = 300_000;

export function createSupervisorLifecycleClient(input: {
  endpoint: SupervisorControlEndpoint;
}) {
  const { transport } = input.endpoint;
  if (transport.kind !== "unix") {
    throw new SupervisorLifecycleClientError({
      cause: null,
      message: `unsupported supervisor control transport ${transport.kind}`,
    });
  }

  return createClient(
    SupervisorLifecycleService,
    createConnectTransport({
      baseUrl: SUPERVISOR_LIFECYCLE_CONNECT_BASE_URL,
      httpVersion: "2",
      nodeOptions: {
        createConnection: () => net.connect(transport.socketPath),
      },
      readMaxBytes: SUPERVISOR_LIFECYCLE_CONNECT_MAX_MESSAGE_BYTES,
      writeMaxBytes: SUPERVISOR_LIFECYCLE_CONNECT_MAX_MESSAGE_BYTES,
    })
  );
}

export type SupervisorLifecycleClient = ReturnType<
  typeof createSupervisorLifecycleClient
>;
