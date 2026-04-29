import { mkdtemp, rm } from "node:fs/promises";
import http2 from "node:http2";
import { join } from "node:path";

import { create } from "@bufbuild/protobuf";
import { DurationSchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ServiceImpl } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  RuntimePhase,
  RuntimeStatusSchema,
  SupervisorIdentitySchema,
  SupervisorPhase,
} from "@onequery/proto-runtime/runtime/v1/common_pb";
import {
  OpenRuntimeSessionResponseSchema,
  SupervisorLifecycleService,
  SupervisorLifecycleServiceGetStatusResponseSchema,
} from "@onequery/proto-runtime/runtime/v1/supervisor_pb";
import type {
  OpenRuntimeSessionRequest,
  OpenRuntimeSessionResponse,
} from "@onequery/proto-runtime/runtime/v1/supervisor_pb";
import { afterEach, describe, expect, it } from "vitest";

import { createSupervisorLifecycleClient } from "./client";
import { openSupervisorRuntimeSession } from "./session";

describe("openSupervisorRuntimeSession", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()));
  });

  it("reports shutdown start and finish after a supervisor stop command", async () => {
    const service = createSessionCapturingSupervisorService([
      create(OpenRuntimeSessionResponseSchema, {
        response: {
          case: "stop",
          value: {
            completion: 2,
            graceTimeout: create(DurationSchema, { seconds: 30n }),
            operationId: "00000000-0000-4000-8000-000000000001",
            reason: "test stop",
            target: {
              dataDir: "/tmp/onequery-data",
              launchId: "launch-a",
              runtimePid: 4242,
              supervisor: {
                generation: 1n,
                pid: 1001,
                supervisorId: "gateway-supervisor:test",
              },
            },
          },
        },
      }),
    ]);
    const { socketPath } = await startSupervisorService(service.impl);
    const client = createSupervisorLifecycleClient({
      endpoint: {
        baseUrl: "http://onequery-supervisor",
        maxMessageBytes: 64 * 1024,
        transport: {
          kind: "unix",
          socketPath,
        },
      },
    });
    const session = openSupervisorRuntimeSession({
      client,
      dataDir: "/tmp/onequery-data",
      heartbeatIntervalMs: 60_000,
      launchId: "launch-a",
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      onStopCommand: async () => ({
        status: create(RuntimeStatusSchema, {
          identity: {
            dataDir: "/tmp/onequery-data",
            launchId: "launch-a",
            pid: 4242,
          },
          phase: RuntimePhase.STOPPED,
          runtimeSequence: 3n,
          updatedAt: timestampFromDate(new Date("2026-04-29T00:00:02.000Z")),
        }),
      }),
      runtimePid: 4242,
      runtimeSequence: 2n,
      supervisor: create(SupervisorIdentitySchema, {
        generation: 1n,
        pid: 1001,
        supervisorId: "gateway-supervisor:test",
      }),
    });
    cleanupTasks.push(() => session.close());

    const events = await service.waitForEvents(3);

    expect(events.map((event) => event.payload.case)).toEqual([
      "hello",
      "shutdownStarted",
      "shutdownFinished",
    ]);
    expect(events[1]?.payload.value).toMatchObject({
      operationId: "00000000-0000-4000-8000-000000000001",
      reason: "test stop",
      runtimeSequence: 2n,
    });
    expect(events[2]?.payload.value).toMatchObject({
      operationId: "00000000-0000-4000-8000-000000000001",
      status: {
        phase: RuntimePhase.STOPPED,
        runtimeSequence: 3n,
      },
    });
  });

  it("reports shutdown failure with a terminal status after a stop command fails", async () => {
    const service = createSessionCapturingSupervisorService([
      create(OpenRuntimeSessionResponseSchema, {
        response: {
          case: "stop",
          value: {
            completion: 2,
            graceTimeout: create(DurationSchema, { seconds: 30n }),
            operationId: "00000000-0000-4000-8000-000000000001",
            reason: "test stop",
            target: {
              dataDir: "/tmp/onequery-data",
              launchId: "launch-a",
              runtimePid: 4242,
              supervisor: {
                generation: 1n,
                pid: 1001,
                supervisorId: "gateway-supervisor:test",
              },
            },
          },
        },
      }),
    ]);
    const { socketPath } = await startSupervisorService(service.impl);
    const client = createSupervisorLifecycleClient({
      endpoint: {
        baseUrl: "http://onequery-supervisor",
        maxMessageBytes: 64 * 1024,
        transport: {
          kind: "unix",
          socketPath,
        },
      },
    });
    const session = openSupervisorRuntimeSession({
      client,
      dataDir: "/tmp/onequery-data",
      heartbeatIntervalMs: 60_000,
      launchId: "launch-a",
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      onStopCommand: async () => {
        throw new Error("stop failed");
      },
      runtimePid: 4242,
      runtimeSequence: 2n,
      supervisor: create(SupervisorIdentitySchema, {
        generation: 1n,
        pid: 1001,
        supervisorId: "gateway-supervisor:test",
      }),
    });
    cleanupTasks.push(() => session.close());
    const closed = session.closed.then(
      () => null,
      (cause: unknown) => cause
    );

    const events = await service.waitForEvents(3);
    const closeCause = await closed;

    expect(events.map((event) => event.payload.case)).toEqual([
      "hello",
      "shutdownStarted",
      "shutdownFailed",
    ]);
    expect(events[2]?.payload.value).toMatchObject({
      failure: {
        message: "stop failed",
      },
      operationId: "00000000-0000-4000-8000-000000000001",
      status: {
        phase: RuntimePhase.SHUTDOWN_FAILED,
        runtimeSequence: 3n,
      },
    });
    expect(closeCause).toBeInstanceOf(Error);
    expect((closeCause as Error).message).toBe("stop failed");
  });

  it("sends hello, ready, and heartbeat events over the supervisor session", async () => {
    const service = createSessionCapturingSupervisorService();
    const { socketPath } = await startSupervisorService(service.impl);
    const client = createSupervisorLifecycleClient({
      endpoint: {
        baseUrl: "http://onequery-supervisor",
        maxMessageBytes: 64 * 1024,
        transport: {
          kind: "unix",
          socketPath,
        },
      },
    });
    const session = openSupervisorRuntimeSession({
      client,
      dataDir: "/tmp/onequery-data",
      heartbeatIntervalMs: 60_000,
      launchId: "launch-a",
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      runtimePid: 4242,
      runtimeSequence: 1n,
      supervisor: create(SupervisorIdentitySchema, {
        generation: 1n,
        pid: 1001,
        supervisorId: "gateway-supervisor:test",
      }),
    });
    cleanupTasks.push(() => session.close());

    await session.ready(
      create(RuntimeStatusSchema, {
        identity: {
          dataDir: "/tmp/onequery-data",
          launchId: "launch-a",
          pid: 4242,
        },
        phase: RuntimePhase.READY,
        runtimeSequence: 2n,
        updatedAt: timestampFromDate(new Date("2026-04-29T00:00:01.000Z")),
      })
    );
    await session.heartbeat();

    const events = await service.waitForEvents(3);

    expect(events.map((event) => event.payload.case)).toEqual([
      "hello",
      "runtimeReady",
      "heartbeat",
    ]);
    expect(events[0]?.payload.value).toMatchObject({
      dataDir: "/tmp/onequery-data",
      launchId: "launch-a",
      runtimePid: 4242,
      runtimeSequence: 1n,
    });
    expect(events[1]?.payload.value).toMatchObject({
      status: {
        phase: RuntimePhase.READY,
        runtimeSequence: 2n,
      },
    });
    expect(events[2]?.payload.value).toMatchObject({
      heartbeatSequence: 1n,
    });
  });

  async function startSupervisorService(
    impl: ServiceImpl<typeof SupervisorLifecycleService>
  ) {
    const dir = await mkdtemp("/tmp/oq-sc-");
    const socketPath = join(dir, "supervisor-control.sock");
    const server = http2.createServer(
      connectNodeAdapter({
        routes(router) {
          router.service(SupervisorLifecycleService, impl);
        },
      })
    );
    cleanupTasks.push(async () => {
      await closeServer(server);
      await rm(dir, {
        force: true,
        recursive: true,
      });
    });
    await listen(server, socketPath);

    return { socketPath };
  }
});

function createSessionCapturingSupervisorService(
  responses: OpenRuntimeSessionResponse[] = []
): {
  impl: ServiceImpl<typeof SupervisorLifecycleService>;
  waitForEvents(count: number): Promise<readonly OpenRuntimeSessionRequest[]>;
} {
  const events: OpenRuntimeSessionRequest[] = [];
  const waiters: Array<{
    count: number;
    resolve(events: readonly OpenRuntimeSessionRequest[]): void;
  }> = [];

  const notify = () => {
    for (const waiter of [...waiters]) {
      if (events.length >= waiter.count) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(events.slice(0, waiter.count));
      }
    }
  };

  return {
    impl: {
      async getStatus() {
        return create(SupervisorLifecycleServiceGetStatusResponseSchema, {
          status: {
            activeSession: true,
            identity: {
              generation: 1n,
              pid: 1001,
              supervisorId: "gateway-supervisor:test",
            },
            launch: {
              dataDir: "/tmp/onequery-data",
              launchId: "launch-a",
              runtimePid: 4242,
              supervisorGeneration: 1n,
              supervisorPid: 1001,
            },
            phase: SupervisorPhase.READY,
            supervisorSequence: 1n,
            updatedAt: timestampFromDate(new Date("2026-04-29T00:00:00.000Z")),
          },
        });
      },
      async *openRuntimeSession(requests) {
        let sentResponses = false;
        for await (const request of requests) {
          events.push(request);
          notify();

          if (!sentResponses) {
            sentResponses = true;
            for (const response of responses) {
              yield response;
            }
          }
        }
      },
      async stop() {
        throw new Error("not implemented");
      },
      watchStatus() {
        return emptyAsyncIterable();
      },
    },
    waitForEvents(count) {
      if (events.length >= count) {
        return Promise.resolve(events.slice(0, count));
      }

      return new Promise((resolve) => {
        waiters.push({ count, resolve });
      });
    },
  };
}

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  for (const item of [] as T[]) {
    yield item;
  }
}

function listen(server: http2.Http2Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (cause: Error) => {
      cleanup();
      reject(cause);
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

function closeServer(server: http2.Http2Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((cause) => {
      if (cause) {
        reject(cause);
        return;
      }

      resolve();
    });
  });
}
