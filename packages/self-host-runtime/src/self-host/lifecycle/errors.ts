import { TaggedError } from "better-result";

import type {
  RuntimeLifecycleFailure,
  RuntimeLifecycleFailureCode,
  SelfHostLifecyclePaths,
} from "./types";

export class DuplicateRuntimeStartError extends TaggedError(
  "DuplicateRuntimeStartError"
)<{
  dataDir: string;
  existingPid: number | null;
  message: string;
}>() {
  constructor(paths: SelfHostLifecyclePaths, existingPid: number | null) {
    super({
      dataDir: paths.dataDir,
      existingPid,
      message:
        existingPid === null
          ? `Self-host runtime is already leased for ${paths.dataDir}`
          : `Self-host runtime already running for ${paths.dataDir} (pid ${existingPid})`,
    });
  }
}

export class RuntimeLifecycleDirectoryError extends TaggedError(
  "RuntimeLifecycleDirectoryError"
)<{
  cause: unknown;
  message: string;
  path: string;
}>() {}

export class RuntimeLifecycleFileError extends TaggedError(
  "RuntimeLifecycleFileError"
)<{
  cause: unknown;
  message: string;
  operation:
    | "append"
    | "close"
    | "open"
    | "read"
    | "remove"
    | "rename"
    | "write";
  path: string;
}>() {}

export class RuntimeLifecycleLogWriteError extends TaggedError(
  "RuntimeLifecycleLogWriteError"
)<{
  cause: unknown;
  message: string;
}>() {}

export class RuntimeLifecycleOptionsError extends TaggedError(
  "RuntimeLifecycleOptionsError"
)<{
  cause: unknown;
  message: string;
}>() {}

export class RuntimeLifecycleTransitionError extends TaggedError(
  "RuntimeLifecycleTransitionError"
)<{
  message: string;
  phase: string;
  runtimeSequence: string;
}>() {}

export class RuntimeLeaseRecordReadError extends TaggedError(
  "RuntimeLeaseRecordReadError"
)<{
  cause: unknown;
  message: string;
  path: string;
}>() {}

export class RuntimeShutdownError extends TaggedError("RuntimeShutdownError")<{
  cause: unknown;
  failure: RuntimeLifecycleFailure;
  message: string;
  reason: string;
}>() {
  constructor(input: {
    cause: unknown;
    failure?: RuntimeLifecycleFailure;
    message: string;
    reason: string;
  }) {
    super({
      ...input,
      failure:
        input.failure ??
        createRuntimeShutdownFailure("internal", input.message),
    });
  }
}

export function createRuntimeShutdownFailure(
  code: RuntimeLifecycleFailureCode,
  message: string,
  retryable = false
): RuntimeLifecycleFailure {
  return {
    code,
    message,
    retryable,
  };
}

export function createRuntimeShutdownError(input: {
  cause: unknown;
  code: RuntimeLifecycleFailureCode;
  message: string;
  reason: string;
  retryable?: boolean;
}): RuntimeShutdownError {
  return new RuntimeShutdownError({
    cause: input.cause,
    failure: createRuntimeShutdownFailure(
      input.code,
      input.message,
      input.retryable ?? false
    ),
    message: input.message,
    reason: input.reason,
  });
}

export class SelfHostRuntimePathsMissingError extends TaggedError(
  "SelfHostRuntimePathsMissingError"
)<{
  message: string;
}>() {}

export type AppendLifecycleLogError =
  | RuntimeLifecycleDirectoryError
  | RuntimeLifecycleFileError;

export type AcquireRuntimeLifecycleLeaseError =
  | DuplicateRuntimeStartError
  | RuntimeLifecycleDirectoryError
  | RuntimeLifecycleFileError
  | RuntimeLifecycleLogWriteError
  | RuntimeLifecycleOptionsError
  | RuntimeLeaseRecordReadError;

export type RuntimeLifecycleMutationError =
  | RuntimeLifecycleFileError
  | RuntimeLifecycleLogWriteError
  | RuntimeLifecycleTransitionError;
