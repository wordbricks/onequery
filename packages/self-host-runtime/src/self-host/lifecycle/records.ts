import { create, fromJsonString, toJsonString } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  LifecycleRecordSchemaVersion,
  LifecycleRecordWriter,
  RuntimeFailureCode,
  RuntimeLeaseRecordSchema,
  RuntimeStatusSnapshotSchema,
} from "@onequery/proto-runtime/runtime/v1/common_pb";
import type {
  RuntimeLeaseRecord,
  RuntimeStatusSnapshot,
  SupervisorIdentity,
} from "@onequery/proto-runtime/runtime/v1/common_pb";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";
import { z } from "zod";

import { RuntimeLeaseRecordReadError } from "./errors";
import type {
  RuntimeLifecycleFailure,
  RuntimeLifecyclePhase,
  SelfHostLifecyclePaths,
} from "./types";

export const lifecycleSchemaVersion = LifecycleRecordSchemaVersion.V1;
const defaultLeaseTtlSeconds = 60n;

export const runtimeLaunchIdSchema = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: "runtime launchId must not be empty",
  });

export function createRuntimeLeaseRecord(input: {
  acquiredAt: Date;
  launchId: string;
  paths: SelfHostLifecyclePaths;
  pid: number;
  runtimeSequence: bigint;
  supervisor: SupervisorIdentity;
}): RuntimeLeaseRecord {
  return create(RuntimeLeaseRecordSchema, {
    acquiredAt: timestampFromDate(input.acquiredAt),
    header: createRuntimeRecordHeader({
      launchId: input.launchId,
      paths: input.paths,
      pid: input.pid,
      supervisor: input.supervisor,
      writtenAt: input.acquiredAt,
    }),
    leaseTtl: {
      nanos: 0,
      seconds: defaultLeaseTtlSeconds,
    },
    renewedAt: timestampFromDate(input.acquiredAt),
    runtime: {
      dataDir: input.paths.dataDir,
      launchId: input.launchId,
      pid: input.pid,
    },
    runtimeSequence: input.runtimeSequence,
    supervisor: input.supervisor,
  });
}

export function renewRuntimeLeaseRecord(
  record: RuntimeLeaseRecord,
  renewedAt: Date,
  runtimeSequence: bigint
): RuntimeLeaseRecord {
  return create(RuntimeLeaseRecordSchema, {
    ...record,
    header: record.header
      ? {
          ...record.header,
          writtenAt: timestampFromDate(renewedAt),
        }
      : undefined,
    renewedAt: timestampFromDate(renewedAt),
    runtimeSequence,
  });
}

export function createRuntimeStatusSnapshot(input: {
  failure?: RuntimeLifecycleFailure;
  launchId: string;
  paths: SelfHostLifecyclePaths;
  phase: RuntimeLifecyclePhase;
  pid: number;
  runtimeSequence: bigint;
  snapshotAt: Date;
  supervisor: SupervisorIdentity;
}): RuntimeStatusSnapshot {
  return create(RuntimeStatusSnapshotSchema, {
    header: createRuntimeRecordHeader({
      launchId: input.launchId,
      paths: input.paths,
      pid: input.pid,
      supervisor: input.supervisor,
      writtenAt: input.snapshotAt,
    }),
    snapshotAt: timestampFromDate(input.snapshotAt),
    status: {
      phase: input.phase,
      runtimeSequence: input.runtimeSequence,
      updatedAt: timestampFromDate(input.snapshotAt),
      ...(input.failure
        ? { failure: toProtoRuntimeFailure(input.failure) }
        : {}),
    },
  });
}

export function encodeRuntimeLeaseRecord(record: RuntimeLeaseRecord): string {
  return `${toJsonString(RuntimeLeaseRecordSchema, record, {
    prettySpaces: 0,
  })}\n`;
}

export function encodeRuntimeStatusSnapshot(
  snapshot: RuntimeStatusSnapshot
): string {
  return `${toJsonString(RuntimeStatusSnapshotSchema, snapshot, {
    prettySpaces: 0,
  })}\n`;
}

export function decodeRuntimeLeaseRecord(
  contents: string,
  path: string
): ResultType<RuntimeLeaseRecord, RuntimeLeaseRecordReadError> {
  return Result.try({
    try: () => fromJsonString(RuntimeLeaseRecordSchema, contents),
    catch: (cause) =>
      new RuntimeLeaseRecordReadError({
        cause,
        message: `invalid runtime lease record at ${path}`,
        path,
      }),
  });
}

function createRuntimeRecordHeader(input: {
  launchId: string;
  paths: SelfHostLifecyclePaths;
  pid: number;
  supervisor: SupervisorIdentity;
  writtenAt: Date;
}) {
  return {
    launch: {
      dataDir: input.paths.dataDir,
      launchId: input.launchId,
      runtimePid: input.pid,
      supervisorGeneration: input.supervisor.generation,
      supervisorPid: input.supervisor.pid,
    },
    schemaVersion: lifecycleSchemaVersion,
    writer: {
      writer: LifecycleRecordWriter.RUNTIME,
      writerId: `runtime:${input.pid}`,
    },
    writtenAt: timestampFromDate(input.writtenAt),
  };
}

function toProtoRuntimeFailure(failure: RuntimeLifecycleFailure) {
  return {
    code: toProtoRuntimeFailureCode(failure.code),
    message: failure.message,
    retryable: failure.retryable,
  };
}

function toProtoRuntimeFailureCode(
  code: RuntimeLifecycleFailure["code"]
): RuntimeFailureCode {
  switch (code) {
    case "checkpoint_failed":
      return RuntimeFailureCode.CHECKPOINT_FAILED;
    case "internal":
      return RuntimeFailureCode.INTERNAL;
    case "resource_close_failed":
      return RuntimeFailureCode.RESOURCE_CLOSE_FAILED;
    case "shutdown_rejected":
      return RuntimeFailureCode.SHUTDOWN_REJECTED;
    case "shutdown_timeout":
      return RuntimeFailureCode.SHUTDOWN_TIMEOUT;
  }
}
