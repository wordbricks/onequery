import { open } from "node:fs/promises";

import type {
  RuntimeLeaseRecord,
  RuntimeStatus,
  RuntimeStatusSnapshot,
} from "@onequery/proto-runtime/runtime/v1/common_pb";
import { RuntimePhase } from "@onequery/proto-runtime/runtime/v1/common_pb";
import { Mutex } from "antiox/sync/mutex";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import {
  DuplicateRuntimeStartError,
  RuntimeLeaseRecordReadError,
  RuntimeLifecycleFileError,
  RuntimeLifecycleOptionsError,
  RuntimeLifecycleTransitionError,
} from "./errors";
import type {
  AcquireRuntimeLifecycleLeaseError,
  RuntimeLifecycleMutationError,
} from "./errors";
import {
  ensureRuntimeDirectories,
  readLifecycleFile,
  removeIfPresent,
  replaceFileWithCompleteContents,
  writeRuntimeStatusSnapshot,
} from "./files";
import { writeLogMessage } from "./log";
import {
  createRuntimeLeaseRecord,
  createRuntimeStatusSnapshot,
  decodeRuntimeLeaseRecord,
  encodeRuntimeLeaseRecord,
  encodeRuntimeStatusSnapshot,
  renewRuntimeLeaseRecord,
  runtimeLaunchIdSchema,
} from "./records";
import type {
  CleanupOptions,
  LifecycleOptions,
  RuntimeLifecycleDurableLease,
  RuntimeLifecycleFailure,
  RuntimeLifecyclePhase,
  RuntimeLifecycleTransitionPersistence,
  SelfHostLifecyclePaths,
} from "./types";

type ResolvedLifecycleOptions = Required<Omit<LifecycleOptions, "launchId">> &
  Pick<LifecycleOptions, "launchId">;

type ActiveRuntimeLeaseRecord = {
  failure?: RuntimeLifecycleFailure;
  phase: RuntimeLifecyclePhase;
  record: RuntimeLeaseRecord;
  status: RuntimeStatus;
  runtimeSequence: bigint;
};

const initialRuntimeSequence = 1n;

const defaultLifecycleOptions: Required<
  Omit<LifecycleOptions, "launchId" | "supervisor">
> = {
  isProcessRunning: defaultIsProcessRunning,
  logWriter: { append: async () => {} },
  now: () => new Date(),
  pid: process.pid,
};

export async function acquireRuntimeLifecycleLeaseResult(
  paths: SelfHostLifecyclePaths,
  options: LifecycleOptions
): Promise<
  ResultType<RuntimeLifecycleDurableLease, AcquireRuntimeLifecycleLeaseError>
> {
  const resolvedResult = resolveLifecycleOptions(options);
  if (resolvedResult.isErr()) {
    return Result.err(resolvedResult.error);
  }

  const resolved = resolvedResult.value;
  let activeRecord: RuntimeLeaseRecord | null = null;

  const acquisition = await Result.gen(async function* acquireLeaseFlow() {
    yield* Result.await(ensureRuntimeDirectories(paths));
    activeRecord = yield* Result.await(acquireLease(paths, resolved));
    const acquiredStatusSnapshot = createRuntimeStatusSnapshot({
      launchId: resolved.launchId,
      paths,
      phase: RuntimePhase.STARTING,
      pid: resolved.pid,
      runtimeSequence: initialRuntimeSequence,
      snapshotAt: resolved.now(),
      supervisor: resolved.supervisor,
    });
    const activeLease: ActiveRuntimeLeaseRecord = {
      phase: RuntimePhase.STARTING,
      record: activeRecord,
      runtimeSequence: initialRuntimeSequence,
      status: runtimeStatusFromSnapshot(acquiredStatusSnapshot),
    };

    yield* Result.await(
      writeRuntimeStatusSnapshot(
        paths,
        encodeRuntimeStatusSnapshot(acquiredStatusSnapshot)
      )
    );
    yield* Result.await(
      writeLogMessage(
        resolved.logWriter,
        `[runtime] acquired lifecycle lease pid=${resolved.pid} dataDir=${paths.dataDir}`
      )
    );

    let released = false;
    const mutationLock = new Mutex(undefined);

    return Result.ok({
      paths,
      async transition(phase, failure) {
        const transitionResult = await withMutationLock(
          mutationLock,
          async () => {
            const occurredAt = resolved.now();
            const transition = createStandaloneLifecycleTransition(
              activeLease,
              phase,
              occurredAt,
              failure
            );
            if (transition === null) {
              return Result.ok(activeLease.status);
            }

            return transitionRuntimeLifecycleLease(
              paths,
              activeLease,
              transition,
              resolved
            );
          }
        );

        return unwrapRuntimeLifecycleMutationResult(transitionResult);
      },
      currentStatus() {
        return activeLease.status;
      },
      terminalStatus(phase, failure) {
        if (activeLease.phase === phase) {
          return activeLease.status;
        }

        const occurredAt = resolved.now();
        const terminalSnapshot = createRuntimeStatusSnapshot({
          failure,
          launchId: resolved.launchId,
          paths,
          phase,
          pid: resolved.pid,
          runtimeSequence: activeLease.runtimeSequence + 1n,
          snapshotAt: occurredAt,
          supervisor: resolved.supervisor,
        });

        activeLease.failure = failure;
        activeLease.phase = phase;
        activeLease.runtimeSequence += 1n;
        activeLease.status = runtimeStatusFromSnapshot(terminalSnapshot);

        return activeLease.status;
      },
      async persistTransition(transition) {
        const transitionResult = await withMutationLock(mutationLock, () =>
          transitionRuntimeLifecycleLease(
            paths,
            activeLease,
            transition,
            resolved
          )
        );

        return unwrapRuntimeLifecycleMutationResult(transitionResult);
      },
      async release({ reason, stopServer }) {
        const releaseResult = await withMutationLock(mutationLock, async () => {
          if (released) {
            return Result.ok(undefined);
          }

          const releaseResult = await releaseRuntimeLifecycleLease(
            paths,
            activeLease.record,
            resolved.logWriter,
            {
              reason,
              stopServer,
            }
          );

          if (releaseResult.isOk()) {
            released = true;
          }

          return releaseResult;
        });

        unwrapRuntimeLifecycleMutationResult(releaseResult);
      },
    } satisfies RuntimeLifecycleDurableLease);
  });
  if (acquisition.isErr() && activeRecord !== null) {
    await cleanupLeaseArtifacts(paths);
  }

  return acquisition;
}

export async function acquireRuntimeLifecycleLease(
  paths: SelfHostLifecyclePaths,
  options: LifecycleOptions
): Promise<RuntimeLifecycleDurableLease> {
  const lease = await acquireRuntimeLifecycleLeaseResult(paths, options);

  if (lease.isErr()) {
    throw lease.error;
  }

  return lease.value;
}

async function withMutationLock<T>(
  mutationLock: Mutex<undefined>,
  mutation: () => Promise<T> | T
): Promise<T> {
  using _guard = await mutationLock.lock();
  return await mutation();
}

function unwrapRuntimeLifecycleMutationResult<T>(
  result: ResultType<T, RuntimeLifecycleMutationError>
): T {
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

async function transitionRuntimeLifecycleLease(
  paths: SelfHostLifecyclePaths,
  activeLease: ActiveRuntimeLeaseRecord,
  transition: RuntimeLifecycleTransitionPersistence,
  options: ResolvedLifecycleOptions
): Promise<ResultType<RuntimeStatus, RuntimeLifecycleMutationError>> {
  const validation = validateLifecycleTransition(activeLease, transition);
  if (validation.isErr()) {
    return Result.err(validation.error);
  }

  const nextRecord = renewRuntimeLeaseRecord(
    activeLease.record,
    transition.occurredAt,
    transition.runtimeSequence
  );
  const nextSnapshot = createRuntimeStatusSnapshot({
    failure: transition.failure,
    launchId: options.launchId,
    paths,
    phase: transition.phase,
    pid: options.pid,
    runtimeSequence: transition.runtimeSequence,
    snapshotAt: transition.occurredAt,
    supervisor: options.supervisor,
  });
  const nextStatus = runtimeStatusFromSnapshot(nextSnapshot);

  const persisted = await Result.gen(async function* transitionLeaseFlow() {
    yield* Result.await(writeRuntimeLeaseRecord(paths, nextRecord));
    yield* Result.await(
      writeRuntimeStatusSnapshot(
        paths,
        encodeRuntimeStatusSnapshot(nextSnapshot)
      )
    );

    return Result.ok(undefined);
  });
  if (persisted.isErr()) {
    return Result.err(persisted.error);
  }

  // Comment: runtime_sequence is allocated by the runtime lifecycle reducer;
  // durable lease state only adopts it after the snapshot writes complete.
  activeLease.failure = transition.failure;
  activeLease.phase = transition.phase;
  activeLease.record = nextRecord;
  activeLease.status = nextStatus;
  activeLease.runtimeSequence = transition.runtimeSequence;

  return Result.ok(nextStatus);
}

function createStandaloneLifecycleTransition(
  activeLease: ActiveRuntimeLeaseRecord,
  phase: RuntimeLifecyclePhase,
  occurredAt: Date,
  failure?: RuntimeLifecycleFailure
): RuntimeLifecycleTransitionPersistence | null {
  if (activeLease.phase === phase) {
    return null;
  }

  return {
    occurredAt,
    ...(failure ? { failure } : {}),
    phase,
    runtimeSequence: activeLease.runtimeSequence + 1n,
  };
}

function runtimeStatusFromSnapshot(
  snapshot: RuntimeStatusSnapshot
): RuntimeStatus {
  if (!snapshot.status) {
    throw new Error("runtime status snapshot omitted status");
  }

  return snapshot.status;
}

function validateLifecycleTransition(
  activeLease: ActiveRuntimeLeaseRecord,
  transition: RuntimeLifecycleTransitionPersistence
): ResultType<void, RuntimeLifecycleTransitionError> {
  if (transition.phase === activeLease.phase) {
    return Result.err(
      new RuntimeLifecycleTransitionError({
        message: `runtime lifecycle phase ${transition.phase} cannot advance sequence ${transition.runtimeSequence.toString()} without changing phase`,
        phase: String(transition.phase),
        runtimeSequence: transition.runtimeSequence.toString(),
      })
    );
  }

  const nextRuntimeSequence = activeLease.runtimeSequence + 1n;
  if (transition.runtimeSequence !== nextRuntimeSequence) {
    return Result.err(
      new RuntimeLifecycleTransitionError({
        message: `runtime lifecycle transition to ${transition.phase} used sequence ${transition.runtimeSequence.toString()} but expected ${nextRuntimeSequence.toString()}`,
        phase: String(transition.phase),
        runtimeSequence: transition.runtimeSequence.toString(),
      })
    );
  }

  return Result.ok(undefined);
}

async function releaseRuntimeLifecycleLease(
  paths: SelfHostLifecyclePaths,
  leaseRecord: RuntimeLeaseRecord,
  logWriter: ResolvedLifecycleOptions["logWriter"],
  options: CleanupOptions
): Promise<ResultType<void, RuntimeLifecycleMutationError>> {
  return Result.gen(async function* releaseLeaseFlow() {
    yield* Result.await(
      writeLogMessage(
        logWriter,
        `[runtime] releasing lifecycle lease pid=${leaseRecord.runtime?.pid ?? "unknown"} reason=${options.reason} stopServer=${options.stopServer ? "yes" : "no"}`
      )
    );
    // Comment: The supervisor records child exit after runtime cleanup. Keep
    // the last runtime-authored snapshot available so the supervisor can
    // advance runtime_sequence monotonically before overwriting it.
    const removeLeaseResult = await removeIfPresent(paths.runtimeLeasePath);
    yield* removeLeaseResult;

    return Result.ok(undefined);
  });
}

async function acquireLease(
  paths: SelfHostLifecyclePaths,
  options: ResolvedLifecycleOptions
): Promise<ResultType<RuntimeLeaseRecord, AcquireRuntimeLifecycleLeaseError>> {
  const acquiredAt = options.now();
  const record = createRuntimeLeaseRecord({
    acquiredAt,
    launchId: options.launchId,
    paths,
    pid: options.pid,
    runtimeSequence: initialRuntimeSequence,
    supervisor: options.supervisor,
  });

  const initialWriteResult = await writeNewLease(
    paths.runtimeLeasePath,
    record
  );
  if (initialWriteResult.isOk()) {
    return Result.ok(record);
  }

  if (!isAlreadyExistsLifecycleError(initialWriteResult.error)) {
    return Result.err(initialWriteResult.error);
  }

  const existingRecord = await readLeaseRecord(paths.runtimeLeasePath);
  const existingPid = existingRecord.isOk()
    ? (existingRecord.value.runtime?.pid ?? null)
    : null;
  const existingLeaseActive =
    existingRecord.isOk() &&
    runtimeLeaseIsActive(existingRecord.value, acquiredAt);
  if (
    existingPid !== null &&
    existingLeaseActive &&
    options.isProcessRunning(existingPid)
  ) {
    const duplicateLogResult = await writeLogMessage(
      options.logWriter,
      `[runtime] duplicate start blocked pid=${existingPid} dataDir=${paths.dataDir}`
    );
    if (duplicateLogResult.isErr()) {
      return Result.err(duplicateLogResult.error);
    }

    return Result.err(new DuplicateRuntimeStartError(paths, existingPid));
  }

  const staleLeaseLogResult = await writeLogMessage(
    options.logWriter,
    `[runtime] removing stale lifecycle lease dataDir=${paths.dataDir} existingPid=${existingPid ?? "unknown"}`
  );
  if (staleLeaseLogResult.isErr()) {
    return Result.err(staleLeaseLogResult.error);
  }

  const [removeLeaseResult, removeStatusResult] = await Promise.all([
    removeIfPresent(paths.runtimeLeasePath),
    removeIfPresent(paths.runtimeStatusSnapshotPath),
  ]);
  if (removeLeaseResult.isErr()) {
    return Result.err(removeLeaseResult.error);
  }
  if (removeStatusResult.isErr()) {
    return Result.err(removeStatusResult.error);
  }

  const replacementWriteResult = await writeNewLease(
    paths.runtimeLeasePath,
    record
  );
  if (replacementWriteResult.isErr()) {
    return Result.err(replacementWriteResult.error);
  }

  return Result.ok(record);
}

function runtimeLeaseIsActive(record: RuntimeLeaseRecord, now: Date): boolean {
  const renewedAtMs = timestampMilliseconds(record.renewedAt);
  const leaseTtlMs = durationMilliseconds(record.leaseTtl);
  if (renewedAtMs === null || leaseTtlMs === null) {
    return false;
  }

  return renewedAtMs + leaseTtlMs > BigInt(now.getTime());
}

function timestampMilliseconds(
  timestamp: RuntimeLeaseRecord["renewedAt"]
): bigint | null {
  if (!timestamp) {
    return null;
  }
  if (timestamp.nanos < 0 || timestamp.nanos >= 1e9) {
    return null;
  }

  return timestamp.seconds * 1000n + BigInt(Math.floor(timestamp.nanos / 1e6));
}

function durationMilliseconds(
  duration: RuntimeLeaseRecord["leaseTtl"]
): bigint | null {
  if (
    !duration ||
    duration.seconds < 0n ||
    duration.nanos < 0 ||
    duration.nanos >= 1e9
  ) {
    return null;
  }

  return duration.seconds * 1000n + BigInt(Math.floor(duration.nanos / 1e6));
}

function resolveLifecycleOptions(
  options: LifecycleOptions
): ResultType<ResolvedLifecycleOptions, RuntimeLifecycleOptionsError> {
  const launchId = runtimeLaunchIdSchema.safeParse(options.launchId);
  if (!launchId.success) {
    return Result.err(
      new RuntimeLifecycleOptionsError({
        cause: launchId.error,
        message: "runtime lifecycle launchId must be a non-empty string",
      })
    );
  }

  const pid = options.pid ?? defaultLifecycleOptions.pid;
  if (!options.supervisor) {
    return Result.err(
      new RuntimeLifecycleOptionsError({
        cause: null,
        message: "runtime lifecycle supervisor identity is required",
      })
    );
  }

  return Result.ok({
    isProcessRunning:
      options.isProcessRunning ?? defaultLifecycleOptions.isProcessRunning,
    launchId: launchId.data,
    logWriter: options.logWriter ?? defaultLifecycleOptions.logWriter,
    now: options.now ?? defaultLifecycleOptions.now,
    pid,
    supervisor: options.supervisor,
  });
}

async function writeNewLease(
  path: string,
  record: RuntimeLeaseRecord
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  const handleResult = await Result.tryPromise({
    try: async () => open(path, "wx", 0o600),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message: `failed to create runtime lease file at ${path}`,
        operation: "open",
        path,
      }),
  });
  if (handleResult.isErr()) {
    return Result.err(handleResult.error);
  }

  const handle = handleResult.value;
  const writeResult = await Result.tryPromise({
    try: async () => handle.writeFile(encodeRuntimeLeaseRecord(record), "utf8"),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message: `failed to write runtime lease file at ${path}`,
        operation: "write",
        path,
      }),
  });
  const closeResult = await Result.tryPromise({
    try: async () => handle.close(),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message: `failed to close runtime lease file at ${path}`,
        operation: "close",
        path,
      }),
  });

  if (writeResult.isErr()) {
    return Result.err(writeResult.error);
  }
  if (closeResult.isErr()) {
    return Result.err(closeResult.error);
  }

  return Result.ok(undefined);
}

async function writeRuntimeLeaseRecord(
  paths: SelfHostLifecyclePaths,
  record: RuntimeLeaseRecord
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  return replaceFileWithCompleteContents(
    paths.runtimeLeasePath,
    encodeRuntimeLeaseRecord(record),
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );
}

async function readLeaseRecord(
  path: string
): Promise<
  ResultType<
    RuntimeLeaseRecord,
    RuntimeLifecycleFileError | RuntimeLeaseRecordReadError
  >
> {
  return Result.gen(async function* readLeaseRecordFlow() {
    const contents = yield* Result.await(
      readLifecycleFile(path, `failed to read runtime lease record at ${path}`)
    );

    return decodeRuntimeLeaseRecord(contents, path);
  });
}

function defaultIsProcessRunning(pid: number): boolean {
  return Result.try(() => process.kill(pid, 0)).isOk();
}

function isAlreadyExistsLifecycleError(
  error: RuntimeLifecycleFileError
): boolean {
  return isAlreadyExistsError(error.cause);
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function cleanupLeaseArtifacts(
  paths: SelfHostLifecyclePaths
): Promise<void> {
  await Promise.all([
    removeIfPresent(paths.runtimeStatusSnapshotPath),
    removeIfPresent(paths.runtimeLeasePath),
  ]);
}
