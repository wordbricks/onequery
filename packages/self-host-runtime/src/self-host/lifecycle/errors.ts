import { TaggedError } from "better-result";

import type { SelfHostLifecyclePaths } from "./types";

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
          ? `Self-host runtime is already locked for ${paths.dataDir}`
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

export class RuntimeLockRecordReadError extends TaggedError(
  "RuntimeLockRecordReadError"
)<{
  cause: unknown;
  message: string;
  path: string;
}>() {}

export class RuntimeShutdownError extends TaggedError("RuntimeShutdownError")<{
  cause: unknown;
  message: string;
  reason: string;
}>() {}

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
  | RuntimeLockRecordReadError;

export type RuntimeLifecycleMutationError =
  | RuntimeLifecycleFileError
  | RuntimeLifecycleLogWriteError;
