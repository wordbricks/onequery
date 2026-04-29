import { mkdtemp, rm } from "node:fs/promises";
import http2 from "node:http2";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { durationFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import {
  RuntimePhase,
  RuntimeStopCompletion,
  RuntimeStopDisposition,
} from "@onequery/proto-runtime/runtime/v1/common_pb";
import { RuntimeControlService } from "@onequery/proto-runtime/runtime/v1/control_pb";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeLifecycleLease } from "./lifecycle";
import {
  createRuntimeControlActor,
  serveRuntimeControl,
} from "./runtime-control";
import { RUNTIME_CONTROL_CONNECT_MAX_TIMEOUT_MS } from "./runtime-control/server";

function createLease(): RuntimeLifecycleLease {
  return {
    paths: {
      controlEndpoint: {
        socketPath: "/tmp/onequery-runtime-control.sock",
        transport: "unix",
      },
      dataDir: "/tmp/onequery-data",
      lockPath: "/tmp/onequery-run/server.lock",
      logsDir: "/tmp/onequery-logs",
      pidPath: "/tmp/onequery-run/server.pid",
    },
    release: vi.fn(async () => undefined),
    transition: vi.fn(async () => undefined),
  };
}

describe("runtime control actor", () => {
  it("accepts one stop request and reports duplicate requests as already stopping", async () => {
    const lease = createLease();
    const shutdown = vi.fn(async () => undefined);
    const actor = createRuntimeControlActor({
      identity: {
        dataDir: "/tmp/onequery-data",
        launchId: "launch-a",
        pid: 123,
      },
      lease,
      now: () => new Date("2026-04-27T00:00:00.000Z"),
    });
    actor.attachShutdownController({
      dispose: vi.fn(),
      shutdown,
    });

    const accepted = await actor.stop({
      completion: RuntimeStopCompletion.CLEANUP_AND_EXIT,
      operationId: "stop-1",
      reason: "gateway_stop",
    });
    const duplicate = await actor.stop({
      completion: RuntimeStopCompletion.CLEANUP_AND_EXIT,
      operationId: "stop-2",
      reason: "gateway_stop",
    });
    const status = await actor.getStatus();

    expect(accepted.disposition).toBe(RuntimeStopDisposition.ACCEPTED);
    expect(accepted.transition).toMatchObject({
      currentPhase: RuntimePhase.STOPPING,
      previousPhase: RuntimePhase.STARTING,
      reason: "gateway_stop",
      sequence: 2n,
    });
    expect(duplicate.disposition).toBe(RuntimeStopDisposition.ALREADY_STOPPING);
    expect(status).toMatchObject({
      phase: RuntimePhase.STOPPING,
      sequence: 2n,
    });
    expect(lease.transition).toHaveBeenCalledWith("stopping");
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith("gateway_stop", "cleanup_and_exit");

    actor.dispose();
  });

  it("streams the current snapshot and later lifecycle transitions", async () => {
    const lease = createLease();
    const actor = createRuntimeControlActor({
      identity: {
        dataDir: "/tmp/onequery-data",
        launchId: "launch-a",
        pid: 123,
      },
      lease,
      now: () => new Date("2026-04-27T00:00:00.000Z"),
    });
    const watchStatus = actor.watchStatus({
      afterSequence: 0n,
      includeSnapshot: true,
    });
    const stream = watchStatus[Symbol.asyncIterator]();

    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: {
        event: {
          case: "snapshot",
          value: {
            phase: RuntimePhase.STARTING,
            sequence: 1n,
          },
        },
      },
    });

    const nextTransition = stream.next();
    await actor.lease.transition("ready");

    await expect(nextTransition).resolves.toMatchObject({
      done: false,
      value: {
        event: {
          case: "transition",
          value: {
            currentPhase: RuntimePhase.READY,
            previousPhase: RuntimePhase.STARTING,
            sequence: 2n,
          },
        },
      },
    });

    await stream.return?.();
    actor.dispose();
  });
});

describe("runtime control Connect server", () => {
  const activeRuntimeControls: {
    actor: ReturnType<typeof createRuntimeControlActor>;
    server: Awaited<ReturnType<typeof serveRuntimeControl>>;
  }[] = [];
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      activeRuntimeControls.splice(0).map(async ({ actor, server }) => {
        try {
          await server.close();
        } finally {
          actor.dispose();
        }
      })
    );
    await Promise.all(
      tempRoots.splice(0).map((root) =>
        rm(root, {
          force: true,
          recursive: true,
        })
      )
    );
  });

  async function startRuntimeControlServer() {
    const root = await mkdtemp(join(tmpdir(), "onequery-runtime-control-"));
    tempRoots.push(root);
    const socketPath = join(root, "runtime-control.sock");
    const lease = createLease();
    lease.paths.controlEndpoint = {
      socketPath,
      transport: "unix",
    };
    const actor = createRuntimeControlActor({
      identity: {
        dataDir: "/tmp/onequery-data",
        launchId: "launch-a",
        pid: 123,
      },
      lease,
      now: () => new Date("2026-04-27T00:00:00.000Z"),
    });
    const shutdown = vi.fn(async () => undefined);
    actor.attachShutdownController({
      dispose: vi.fn(),
      shutdown,
    });
    const server = await serveRuntimeControl({
      actor,
      endpoint: lease.paths.controlEndpoint,
    });
    activeRuntimeControls.push({
      actor,
      server,
    });

    return {
      shutdown,
      socketPath,
    };
  }

  function createRuntimeControlClient(socketPath: string) {
    const client = createClient(
      RuntimeControlService,
      createConnectTransport({
        baseUrl: "http://onequery-runtime",
        httpVersion: "2",
        nodeOptions: {
          createConnection: () => net.connect(socketPath),
        },
      })
    );

    return client;
  }

  it("serves Connect over HTTP/2 on a Unix socket", async () => {
    const { shutdown, socketPath } = await startRuntimeControlServer();
    const client = createRuntimeControlClient(socketPath);

    const status = await client.getStatus({});
    const stop = await client.stop({
      completion: RuntimeStopCompletion.CLEANUP_AND_EXIT,
      graceTimeout: durationFromMs(30_000),
      operationId: "018f0789-cc38-7d46-9a6b-83a2c8f0a001",
      reason: "gateway_stop",
    });

    expect(status.status).toMatchObject({
      identity: {
        dataDir: "/tmp/onequery-data",
        launchId: "launch-a",
        pid: 123,
      },
      phase: RuntimePhase.STARTING,
      sequence: 1n,
    });
    expect(stop.disposition).toBe(RuntimeStopDisposition.ACCEPTED);
    expect(stop.status).toMatchObject({
      phase: RuntimePhase.STOPPING,
      sequence: 2n,
    });
    expect(shutdown).toHaveBeenCalledWith("gateway_stop", "cleanup_and_exit");
  });

  it("requires the Connect protocol version header", async () => {
    const { socketPath } = await startRuntimeControlServer();

    const response = await postUnaryWithoutConnectProtocolHeader(
      socketPath,
      "/onequery.runtime.v1.RuntimeControlService/GetStatus"
    );

    expect(response.status).toBe(400);
    expect(response.body).toContain("Connect-Protocol-Version");
  });

  it("rejects caller timeouts above the runtime control bound", async () => {
    const { socketPath } = await startRuntimeControlServer();
    const client = createRuntimeControlClient(socketPath);

    let error: unknown;
    try {
      await client.getStatus(
        {},
        {
          timeoutMs: RUNTIME_CONTROL_CONNECT_MAX_TIMEOUT_MS + 1,
        }
      );
    } catch (caught) {
      error = caught;
    }

    const connectError = ConnectError.from(error);
    expect(connectError.code).toBe(Code.InvalidArgument);
    expect(connectError.message).toContain(
      `timeout ${RUNTIME_CONTROL_CONNECT_MAX_TIMEOUT_MS + 1}ms must be <= ${RUNTIME_CONTROL_CONNECT_MAX_TIMEOUT_MS}`
    );
  });
});

function postUnaryWithoutConnectProtocolHeader(
  socketPath: string,
  path: string
): Promise<{
  body: string;
  status?: number;
}> {
  const client = http2.connect("http://onequery-runtime", {
    createConnection: () => net.connect(socketPath),
  });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let status: number | undefined;
    const request = client.request({
      [http2.constants.HTTP2_HEADER_METHOD]: "POST",
      [http2.constants.HTTP2_HEADER_PATH]: path,
      [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "application/proto",
    });

    const fail = (cause: unknown) => {
      client.close();
      reject(cause);
    };

    client.once("error", fail);
    request.once("error", fail);
    request.once("response", (headers) => {
      const rawStatus = headers[http2.constants.HTTP2_HEADER_STATUS];
      status = typeof rawStatus === "number" ? rawStatus : undefined;
    });
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.once("end", () => {
      client.off("error", fail);
      request.off("error", fail);
      client.close();
      resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        status,
      });
    });
    request.end();
  });
}
