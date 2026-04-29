import { open } from "node:fs/promises";

import { create } from "@bufbuild/protobuf";
import { SupervisorIdentitySchema } from "@onequery/proto-runtime/runtime/v1/common_pb";
import type {
  RuntimeLeaseRecord,
  SupervisorIdentity,
} from "@onequery/proto-runtime/runtime/v1/common_pb";
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
  runtimeSequence: bigint;
};

const initialRuntimeSequence = 1n;

const defaultLifecycleOptions: Required<Omit<LifecycleOptions, "launchId">> = {
  isProcessRunning: defaultIsProcessRunning,
  logWriter: { append: async () => {} },
  now: () => new Date(),
  pid: process.pid,
  supervisor: defaultSupervisorIdentity(process.pid, "unspecified"),
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
    const activeLease: ActiveRuntimeLeaseRecord = {
      phase: "starting",
      record: activeRecord,
      runtimeSequence: initialRuntimeSequence,
    };

    yield* Result.await(
      writeRuntimeStatusSnapshot(
        paths,
        encodeRuntimeStatusSnapshot(
          createRuntimeStatusSnapshot({
            launchId: resolved.launchId,
            paths,
            phase: "starting",
            pid: resolved.pid,
            runtimeSequence: activeLease.runtimeSequence,
            snapshotAt: resolved.now(),
            supervisor: resolved.supervisor,
          })
        )
      )
    );
    yield* Result.await(
      writeLogMessage(
        resolved.logWriter,
        `[runtime] acquired lifecycle lease pid=${resolved.pid} dataDir=${paths.dataDir}`
      )
    );

    let released = false;

    return Result.ok({
      paths,
      async transition(phase, failure) {
        const occurredAt = resolved.now();
        const transition = createStandaloneLifecycleTransition(
          activeLease,
          phase,
          occurredAt,
          failure
        );
        if (transition === null) {
          return;
        }

        const transitionResult = await transitionRuntimeLifecycleLease(
          paths,
          activeLease,
          transition,
          resolved
        );

        if (transitionResult.isErr()) {
          throw transitionResult.error;
        }
      },
      async persistTransition(transition) {
        const transitionResult = await transitionRuntimeLifecycleLease(
          paths,
          activeLease,
          transition,
          resolved
        );

        if (transitionResult.isErr()) {
          throw transitionResult.error;
        }
      },
      async release({ reason, stopServer }) {
        if (released) {
          return;
        }

        released = true;
        const releaseResult = await releaseRuntimeLifecycleLease(
          paths,
          activeLease.record,
          resolved.logWriter,
          {
            reason,
            stopServer,
          }
        );

        if (releaseResult.isErr()) {
          throw releaseResult.error;
        }
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

async function transitionRuntimeLifecycleLease(
  paths: SelfHostLifecyclePaths,
  activeLease: ActiveRuntimeLeaseRecord,
  transition: RuntimeLifecycleTransitionPersistence,
  options: ResolvedLifecycleOptions
): Promise<ResultType<void, RuntimeLifecycleMutationError>> {
  const validation = validateLifecycleTransition(activeLease, transition);
  if (validation.isErr()) {
    return Result.err(validation.error);
  }

  const nextRecord = renewRuntimeLeaseRecord(
    activeLease.record,
    transition.occurredAt,
    transition.runtimeSequence
  );

  const persisted = await Result.gen(async function* transitionLeaseFlow() {
    yield* Result.await(writeRuntimeLeaseRecord(paths, nextRecord));
    yield* Result.await(
      writeRuntimeStatusSnapshot(
        paths,
        encodeRuntimeStatusSnapshot(
          createRuntimeStatusSnapshot({
            failure: transition.failure,
            launchId: options.launchId,
            paths,
            phase: transition.phase,
            pid: options.pid,
            runtimeSequence: transition.runtimeSequence,
            snapshotAt: transition.occurredAt,
            supervisor: options.supervisor,
          })
        )
      )
    );

    return Result.ok(undefined);
  });
  if (persisted.isErr()) {
    return Result.err(persisted.error);
  }

  // Comment: runtime_sequence is allocated by the runtime-control reducer;
  // durable lease state only adopts it after the snapshot writes complete.
  activeLease.failure = transition.failure;
  activeLease.phase = transition.phase;
  activeLease.record = nextRecord;
  activeLease.runtimeSequence = transition.runtimeSequence;

  return Result.ok(undefined);
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

function validateLifecycleTransition(
  activeLease: ActiveRuntimeLeaseRecord,
  transition: RuntimeLifecycleTransitionPersistence
): ResultType<void, RuntimeLifecycleTransitionError> {
  if (transition.phase === activeLease.phase) {
    return Result.err(
      new RuntimeLifecycleTransitionError({
        message: `runtime lifecycle phase ${transition.phase} cannot advance sequence ${transition.runtimeSequence.toString()} without changing phase`,
        phase: transition.phase,
        runtimeSequence: transition.runtimeSequence.toString(),
      })
    );
  }

  const nextRuntimeSequence = activeLease.runtimeSequence + 1n;
  if (transition.runtimeSequence !== nextRuntimeSequence) {
    return Result.err(
      new RuntimeLifecycleTransitionError({
        message: `runtime lifecycle transition to ${transition.phase} used sequence ${transition.runtimeSequence.toString()} but expected ${nextRuntimeSequence.toString()}`,
        phase: transition.phase,
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
    const [removeRuntimeStatusResult, removeLeaseResult] = await Promise.all([
      removeIfPresent(paths.runtimeStatusSnapshotPath),
      removeIfPresent(paths.runtimeLeasePath),
    ]);

    yield* removeRuntimeStatusResult;
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
  if (existingPid !== null && options.isProcessRunning(existingPid)) {
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

  return Result.ok({
    isProcessRunning:
      options.isProcessRunning ?? defaultLifecycleOptions.isProcessRunning,
    launchId: launchId.data,
    logWriter: options.logWriter ?? defaultLifecycleOptions.logWriter,
    now: options.now ?? defaultLifecycleOptions.now,
    pid,
    supervisor:
      options.supervisor ?? defaultSupervisorIdentity(pid, launchId.data),
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

function defaultSupervisorIdentity(
  runtimePid: number,
  launchId: string
): SupervisorIdentity {
  const supervisorPid = process.ppid > 0 ? process.ppid : runtimePid;

  return create(SupervisorIdentitySchema, {
    generation: 1n,
    pid: supervisorPid,
    // Comment: supervisor generation is fixed until the Rust supervisor state
    // machine owns durable generation allocation.
    supervisorId: `runtime-parent:${launchId}:${supervisorPid}`,
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
