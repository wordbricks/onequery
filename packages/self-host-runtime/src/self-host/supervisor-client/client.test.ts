import { mkdtemp, rm } from "node:fs/promises";
import http2 from "node:http2";
import { join } from "node:path";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ServiceImpl } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { createSelfHostSupervisorControl } from "@onequery/config/testing";
import { SupervisorPhase } from "@onequery/proto-runtime/runtime/v1/common_pb";
import {
  SupervisorLifecycleService,
  SupervisorLifecycleServiceGetStatusResponseSchema,
} from "@onequery/proto-runtime/runtime/v1/supervisor_pb";
import { afterEach, describe, expect, it } from "vitest";

import { createSupervisorLifecycleClient } from "./client";

describe("createSupervisorLifecycleClient", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()));
  });

  it("connects to a supervisor lifecycle service over a Unix socket", async () => {
    const dir = await mkdtemp("/tmp/oq-sc-");
    const socketPath = join(dir, "supervisor-control.sock");
    const server = http2.createServer(
      connectNodeAdapter({
        routes(router) {
          router.service(SupervisorLifecycleService, supervisorService());
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

    const client = createSupervisorLifecycleClient({
      endpoint: createSelfHostSupervisorControl({ socketPath }),
    });
    const response = await client.getStatus({
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
    });

    expect(response.status?.supervisorSequence).toEqual(7n);
    expect(response.status?.phase).toEqual(SupervisorPhase.READY);
  });
});

function supervisorService(): ServiceImpl<typeof SupervisorLifecycleService> {
  return {
    async getStatus() {
      return create(SupervisorLifecycleServiceGetStatusResponseSchema, {
        status: {
          activeSession: false,
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
          supervisorSequence: 7n,
          updatedAt: timestampFromDate(new Date("2026-04-29T00:00:00.000Z")),
        },
      });
    },
    async stop() {
      throw new Error("not implemented");
    },
    watchStatus() {
      return emptyAsyncIterable();
    },
    openRuntimeSession() {
      return emptyAsyncIterable();
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
