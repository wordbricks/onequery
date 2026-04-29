import { mkdtemp, rm } from "node:fs/promises";
import http2 from "node:http2";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { durationFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import {
  BadRequestSchema,
  ErrorInfoSchema,
  PreconditionFailureSchema,
  ResourceInfoSchema,
  RetryInfoSchema,
} from "@onequery/proto-runtime/google/rpc/error_details_pb";
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
import { RuntimeControlOperationConflictError } from "./runtime-control/actor";
import {
  RUNTIME_CONTROL_CONNECT_MAX_TIMEOUT_MS,
  RUNTIME_CONTROL_ERROR_INFO_DOMAIN,
} from "./runtime-control/server";

function createLease(): RuntimeLifecycleLease {
  return {
    paths: {
      controlEndpoint: {
        socketPath: "/tmp/onequery-runtime-control.sock",
        transport: "unix",
      },
      dataDir: "/tmp/onequery-data",
      logsDir: "/tmp/onequery-logs",
      runtimeLeasePath: "/tmp/onequery-run/runtime.lease.json",
      runtimeStatusSnapshotPath: "/tmp/onequery-run/runtime.status.json",
    },
    release: vi.fn(async () => undefined),
    transition: vi.fn(async () => undefined),
  };
}

function runtimeTarget(
  overrides: Partial<{
    dataDir: string;
    launchId: string;
    pid: number;
  }> = {}
) {
  return {
    dataDir: "/tmp/onequery-data",
    launchId: "launch-a",
    pid: 123,
    ...overrides,
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
    const firstOperationId = "018f0789-cc38-7d46-9a6b-83a2c8f0a001";
    const secondOperationId = "018f0789-cc38-7d46-9a6b-83a2c8f0a002";

    const accepted = await actor.stop({
      completion: RuntimeStopCompletion.CLEANUP_AND_EXIT,
      operationId: firstOperationId,
      reason: "gateway_stop",
      target: runtimeTarget(),
    });
    const duplicate = await actor.stop({
      completion: RuntimeStopCompletion.CLEANUP_AND_EXIT,
      operationId: secondOperationId,
      reason: "gateway_stop",
      target: runtimeTarget(),
    });
    const status = await actor.getStatus();

    expect(accepted.disposition).toBe(RuntimeStopDisposition.ACCEPTED);
    expect(accepted.transition).toMatchObject({
      callerOperationId: firstOperationId,
      currentPhase: RuntimePhase.STOPPING,
      previousPhase: RuntimePhase.STARTING,
      reason: "gateway_stop",
      runtimeSequence: 2n,
      transitionId: "runtime:2",
    });
    expect(duplicate.disposition).toBe(RuntimeStopDisposition.ALREADY_STOPPING);
    expect(status).toMatchObject({
      phase: RuntimePhase.STOPPING,
      runtimeSequence: 2n,
    });
    expect(lease.transition).toHaveBeenCalledWith("stopping");
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith("gateway_stop", "cleanup_and_exit");

    actor.dispose();
  });

  it("replays the same stop response when an operation id is retried", async () => {
    const lease = createLease();
    const shutdown = vi.fn(() => new Promise<void>(() => undefined));
    const timestamps = [
      new Date("2026-04-27T00:00:00.000Z"),
      new Date("2026-04-27T00:00:01.000Z"),
      new Date("2026-04-27T00:00:02.000Z"),
      new Date("2026-04-27T00:00:03.000Z"),
    ];
    const actor = createRuntimeControlActor({
      identity: {
        dataDir: "/tmp/onequery-data",
        launchId: "launch-a",
        pid: 123,
      },
      lease,
      now: () => timestamps.shift() ?? new Date("2026-04-27T00:00:04.000Z"),
    });
    actor.attachShutdownController({
      dispose: vi.fn(),
      shutdown,
    });
    const operationId = "018f0789-cc38-7d46-9a6b-83a2c8f0a003";
    const request = {
      completion: RuntimeStopCompletion.CLEANUP_AND_EXIT,
      operationId,
      reason: "gateway_stop",
      target: runtimeTarget(),
    };

    const accepted = await actor.stop(request);
    await actor.lease.transition("draining");
    const retried = await actor.stop(request);
    const current = await actor.getStatus();

    expect(accepted.disposition).toBe(RuntimeStopDisposition.ACCEPTED);
    expect(retried).toEqual(accepted);
    expect(current).toMatchObject({
      phase: RuntimePhase.DRAINING,
      runtimeSequence: 3n,
    });
    expect(lease.transition).toHaveBeenCalledTimes(2);
    expect(lease.transition).toHaveBeenNthCalledWith(1, "stopping");
    expect(lease.transition).toHaveBeenNthCalledWith(2, "draining");
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith("gateway_stop", "cleanup_and_exit");

    actor.dispose();
  });

  it("rejects operation id reuse with a different stop request", async () => {
    const lease = createLease();
    const shutdown = vi.fn(() => new Promise<void>(() => undefined));
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
    const operationId = "018f0789-cc38-7d46-9a6b-83a2c8f0a004";
    const request = {
      completion: RuntimeStopCompletion.CLEANUP_AND_EXIT,
      graceTimeout: durationFromMs(30_000),
      operationId,
      reason: "gateway_stop",
      target: runtimeTarget(),
    };

    await actor.stop(request);

    let error: unknown;
    try {
      await actor.stop({
        ...request,
        reason: "operator_stop",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RuntimeControlOperationConflictError);
    expect(error).toMatchObject({
      actual: "operator_stop",
      expected: "gateway_stop",
      field: "reason",
      operation: "stop",
      operationId,
    });
    expect(lease.transition).toHaveBeenCalledTimes(1);
    expect(lease.transition).toHaveBeenCalledWith("stopping");
    expect(shutdown).toHaveBeenCalledTimes(1);

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
      afterRuntimeSequence: 0n,
      includeSnapshot: true,
      target: runtimeTarget(),
    });
    const stream = watchStatus[Symbol.asyncIterator]();

    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: {
        event: {
          case: "snapshot",
          value: {
            phase: RuntimePhase.STARTING,
            runtimeSequence: 1n,
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
            runtimeSequence: 2n,
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

  async function startRuntimeControlServer(
    input: {
      attachShutdownController?: boolean;
    } = {}
  ) {
    const options = {
      attachShutdownController: true,
      ...input,
    };
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
    if (options.attachShutdownController) {
      actor.attachShutdownController({
        dispose: vi.fn(),
        shutdown,
      });
    }
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

  function summarizeRuntimeControlConnectError(error: ConnectError) {
    return {
      badRequest: error.findDetails(BadRequestSchema).map((detail) => ({
        fieldViolations: detail.fieldViolations.map((violation) => ({
          description: violation.description,
          field: violation.field,
          reason: violation.reason,
        })),
      })),
      errorInfo: error.findDetails(ErrorInfoSchema).map((detail) => ({
        domain: detail.domain,
        metadata: detail.metadata,
        reason: detail.reason,
      })),
      preconditionFailure: error
        .findDetails(PreconditionFailureSchema)
        .map((detail) => ({
          violations: detail.violations.map((violation) => ({
            description: violation.description,
            subject: violation.subject,
            type: violation.type,
          })),
        })),
      resourceInfo: error.findDetails(ResourceInfoSchema).map((detail) => ({
        description: detail.description,
        resourceName: detail.resourceName,
        resourceType: detail.resourceType,
      })),
      retryInfo: error.findDetails(RetryInfoSchema).map((detail) => ({
        retryDelay: detail.retryDelay
          ? {
              nanos: detail.retryDelay.nanos,
              seconds: detail.retryDelay.seconds.toString(),
            }
          : null,
      })),
    };
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
      target: runtimeTarget(),
    });

    expect(status.status).toMatchObject({
      identity: {
        dataDir: "/tmp/onequery-data",
        launchId: "launch-a",
        pid: 123,
      },
      phase: RuntimePhase.STARTING,
      runtimeSequence: 1n,
    });
    expect(stop.disposition).toBe(RuntimeStopDisposition.ACCEPTED);
    expect(stop.status).toMatchObject({
      phase: RuntimePhase.STOPPING,
      runtimeSequence: 2n,
    });
    expect(shutdown).toHaveBeenCalledWith("gateway_stop", "cleanup_and_exit");
  });

  it("rejects stale runtime targets with failed precondition", async () => {
    const { shutdown, socketPath } = await startRuntimeControlServer();
    const client = createRuntimeControlClient(socketPath);

    let error: unknown;
    try {
      await client.stop({
        completion: RuntimeStopCompletion.CLEANUP_AND_EXIT,
        graceTimeout: durationFromMs(30_000),
        operationId: "018f0789-cc38-7d46-9a6b-83a2c8f0a002",
        reason: "gateway_stop",
        target: runtimeTarget({
          launchId: "launch-b",
        }),
      });
    } catch (caught) {
      error = caught;
    }

    const connectError = ConnectError.from(error);
    const details = summarizeRuntimeControlConnectError(connectError);
    expect(connectError.code).toBe(Code.FailedPrecondition);
    expect(connectError.message).toContain("launch_id mismatch");
    expect(details.errorInfo).toEqual([
      expect.objectContaining({
        domain: RUNTIME_CONTROL_ERROR_INFO_DOMAIN,
        metadata: expect.objectContaining({
          actual: "launch-b",
          expected: "launch-a",
          field: "launch_id",
          operation: "stop",
          retryable: "false",
        }),
        reason: "RUNTIME_CONTROL_TARGET_PRECONDITION_FAILED",
      }),
    ]);
    expect(details.preconditionFailure).toEqual([
      {
        violations: [
          expect.objectContaining({
            subject: "launch_id",
            type: "RUNTIME_TARGET_MISMATCH",
          }),
        ],
      },
    ]);
    expect(details.resourceInfo).toEqual([
      expect.objectContaining({
        resourceName: "target.launch_id:launch-a",
        resourceType: "onequery.runtime.control.target",
      }),
    ]);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("maps operation id conflicts to invalid argument", async () => {
    const { shutdown, socketPath } = await startRuntimeControlServer();
    const client = createRuntimeControlClient(socketPath);
    const operationId = "018f0789-cc38-7d46-9a6b-83a2c8f0a003";
    const request = {
      completion: RuntimeStopCompletion.CLEANUP_AND_EXIT,
      graceTimeout: durationFromMs(30_000),
      operationId,
      reason: "gateway_stop",
      target: runtimeTarget(),
    };

    await client.stop(request);

    let error: unknown;
    try {
      await client.stop({
        ...request,
        completion: RuntimeStopCompletion.CLEANUP_ONLY,
      });
    } catch (caught) {
      error = caught;
    }

    const connectError = ConnectError.from(error);
    const details = summarizeRuntimeControlConnectError(connectError);
    expect(connectError.code).toBe(Code.InvalidArgument);
    expect(connectError.message).toContain(
      `operation_id ${operationId} was already used with a different completion`
    );
    expect(details.errorInfo).toEqual([
      expect.objectContaining({
        domain: RUNTIME_CONTROL_ERROR_INFO_DOMAIN,
        metadata: expect.objectContaining({
          field: "completion",
          operation: "stop",
          operationId,
          retryable: "false",
        }),
        reason: "RUNTIME_CONTROL_OPERATION_CONFLICT",
      }),
    ]);
    expect(details.badRequest).toEqual([
      {
        fieldViolations: expect.arrayContaining([
          expect.objectContaining({
            field: "operation_id",
            reason: "OPERATION_ID_REUSE_CONFLICT",
          }),
          expect.objectContaining({
            field: "completion",
            reason: "OPERATION_ID_CONFLICTING_FIELD",
          }),
        ]),
      },
    ]);
    expect(details.resourceInfo).toEqual([
      expect.objectContaining({
        resourceName: operationId,
        resourceType: "onequery.runtime.control.stop_operation",
      }),
    ]);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("normalizes runtime control request validation failures", async () => {
    const { shutdown, socketPath } = await startRuntimeControlServer();
    const client = createRuntimeControlClient(socketPath);

    let error: unknown;
    try {
      await client.stop({
        completion: RuntimeStopCompletion.CLEANUP_AND_EXIT,
        graceTimeout: durationFromMs(30_000),
        operationId: "not-a-uuid",
        reason: "gateway_stop",
        target: runtimeTarget(),
      });
    } catch (caught) {
      error = caught;
    }

    const connectError = ConnectError.from(error);
    const details = summarizeRuntimeControlConnectError(connectError);
    expect(connectError.code).toBe(Code.InvalidArgument);
    expect(details.errorInfo).toEqual([
      expect.objectContaining({
        domain: RUNTIME_CONTROL_ERROR_INFO_DOMAIN,
        metadata: expect.objectContaining({
          operation: "Stop",
          retryable: "false",
        }),
        reason: "RUNTIME_CONTROL_REQUEST_INVALID",
      }),
    ]);
    expect(details.badRequest).toEqual([
      {
        fieldViolations: expect.arrayContaining([
          expect.objectContaining({
            field: "operation_id",
            reason: "STRING_UUID",
          }),
        ]),
      },
    ]);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("marks startup-not-ready actor failures as retryable", async () => {
    const { shutdown, socketPath } = await startRuntimeControlServer({
      attachShutdownController: false,
    });
    const client = createRuntimeControlClient(socketPath);

    let error: unknown;
    try {
      await client.stop({
        completion: RuntimeStopCompletion.CLEANUP_AND_EXIT,
        graceTimeout: durationFromMs(30_000),
        operationId: "018f0789-cc38-7d46-9a6b-83a2c8f0a004",
        reason: "gateway_stop",
        target: runtimeTarget(),
      });
    } catch (caught) {
      error = caught;
    }

    const connectError = ConnectError.from(error);
    const details = summarizeRuntimeControlConnectError(connectError);
    expect(connectError.code).toBe(Code.Unavailable);
    expect(details.errorInfo).toEqual([
      expect.objectContaining({
        domain: RUNTIME_CONTROL_ERROR_INFO_DOMAIN,
        metadata: expect.objectContaining({
          operation: "stop",
          retryable: "true",
        }),
        reason: "RUNTIME_CONTROL_STARTUP_NOT_READY",
      }),
    ]);
    expect(details.retryInfo).toEqual([
      {
        retryDelay: {
          nanos: 250_000_000,
          seconds: "0",
        },
      },
    ]);
    expect(shutdown).not.toHaveBeenCalled();
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
