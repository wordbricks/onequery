import { open } from "node:fs/promises";

import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import {
  DuplicateRuntimeStartError,
  RuntimeLifecycleFileError,
  RuntimeLifecycleOptionsError,
  RuntimeLockRecordReadError,
} from "./errors";
import type {
  AcquireRuntimeLifecycleLeaseError,
  RuntimeLifecycleMutationError,
} from "./errors";
import {
  ensureRuntimeDirectories,
  readLifecycleFile,
  removeIfPresent,
  runtimeStatePath,
  writeLifecycleFile,
  writeRuntimeState,
} from "./files";
import { writeLogMessage } from "./log";
import {
  createRuntimeStateRecord,
  decodeRuntimeLockRecord,
  runtimeLaunchIdSchema,
} from "./records";
import type {
  CleanupOptions,
  LifecycleOptions,
  RuntimeLifecycleLease,
  RuntimeLifecyclePhase,
  RuntimeLockRecord,
  SelfHostLifecyclePaths,
} from "./types";

type ResolvedLifecycleOptions = Required<Omit<LifecycleOptions, "launchId">> &
  Pick<LifecycleOptions, "launchId">;

const defaultLifecycleOptions: Required<Omit<LifecycleOptions, "launchId">> = {
  isProcessRunning: defaultIsProcessRunning,
  logWriter: { append: async () => {} },
  now: () => new Date(),
  pid: process.pid,
};

export async function acquireRuntimeLifecycleLeaseResult(
  paths: SelfHostLifecyclePaths,
  options: LifecycleOptions
): Promise<
  ResultType<RuntimeLifecycleLease, AcquireRuntimeLifecycleLeaseError>
> {
  const resolvedResult = resolveLifecycleOptions(options);
  if (resolvedResult.isErr()) {
    return Result.err(resolvedResult.error);
  }

  const resolved = resolvedResult.value;
  let lockRecord: RuntimeLockRecord | null = null;

  const acquisition = await Result.gen(async function* acquireLeaseFlow() {
    yield* Result.await(ensureRuntimeDirectories(paths));
    lockRecord = yield* Result.await(acquireLock(paths, resolved));
    yield* Result.await(
      writeRuntimeState(
        paths,
        createRuntimeStateRecord(lockRecord, "starting", resolved.now)
      )
    );
    yield* Result.await(
      writeLifecycleFile(
        paths.pidPath,
        `${lockRecord.pid}\n`,
        "write",
        `failed to write runtime pid file at ${paths.pidPath}`,
        {
          encoding: "utf8",
        }
      )
    );
    yield* Result.await(
      writeLogMessage(
        resolved.logWriter,
        `[runtime] acquired lifecycle lease pid=${lockRecord.pid} dataDir=${paths.dataDir}`
      )
    );
    const activeLockRecord = lockRecord;

    let released = false;

    return Result.ok({
      paths,
      async transition(phase) {
        const transitionResult = await transitionRuntimeLifecycleLease(
          paths,
          activeLockRecord,
          phase,
          resolved.now
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
          activeLockRecord,
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
    } satisfies RuntimeLifecycleLease);
  });
  if (acquisition.isErr() && lockRecord !== null) {
    await cleanupLeaseArtifacts(paths);
  }

  return acquisition;
}

export async function acquireRuntimeLifecycleLease(
  paths: SelfHostLifecyclePaths,
  options: LifecycleOptions
): Promise<RuntimeLifecycleLease> {
  const lease = await acquireRuntimeLifecycleLeaseResult(paths, options);

  if (lease.isErr()) {
    throw lease.error;
  }

  return lease.value;
}

async function transitionRuntimeLifecycleLease(
  paths: SelfHostLifecyclePaths,
  lockRecord: RuntimeLockRecord,
  phase: RuntimeLifecyclePhase,
  now: () => Date
): Promise<ResultType<void, RuntimeLifecycleMutationError>> {
  return writeRuntimeState(
    paths,
    createRuntimeStateRecord(lockRecord, phase, now)
  );
}

async function releaseRuntimeLifecycleLease(
  paths: SelfHostLifecyclePaths,
  lockRecord: RuntimeLockRecord,
  logWriter: ResolvedLifecycleOptions["logWriter"],
  options: CleanupOptions
): Promise<ResultType<void, RuntimeLifecycleMutationError>> {
  return Result.gen(async function* releaseLeaseFlow() {
    yield* Result.await(
      writeLogMessage(
        logWriter,
        `[runtime] releasing lifecycle lease pid=${lockRecord.pid} reason=${options.reason} stopServer=${options.stopServer ? "yes" : "no"}`
      )
    );
    const [removeRuntimeStateResult, removePidResult] = await Promise.all([
      removeIfPresent(runtimeStatePath(paths)),
      removeIfPresent(paths.pidPath),
    ]);

    yield* removeRuntimeStateResult;
    yield* removePidResult;
    yield* Result.await(removeIfPresent(paths.lockPath));

    return Result.ok(undefined);
  });
}

async function acquireLock(
  paths: SelfHostLifecyclePaths,
  options: ResolvedLifecycleOptions
): Promise<ResultType<RuntimeLockRecord, AcquireRuntimeLifecycleLeaseError>> {
  const record: RuntimeLockRecord = {
    pid: options.pid,
    acquiredAt: options.now().toISOString(),
    dataDir: paths.dataDir,
    launchId: options.launchId,
  };

  const initialWriteResult = await writeNewLock(paths.lockPath, record);
  if (initialWriteResult.isOk()) {
    return Result.ok(record);
  }

  if (!isAlreadyExistsLifecycleError(initialWriteResult.error)) {
    return Result.err(initialWriteResult.error);
  }

  const existingRecord = await readLockRecord(paths.lockPath);
  if (
    existingRecord.isOk() &&
    options.isProcessRunning(existingRecord.value.pid)
  ) {
    const duplicateLogResult = await writeLogMessage(
      options.logWriter,
      `[runtime] duplicate start blocked pid=${existingRecord.value.pid} dataDir=${paths.dataDir}`
    );
    if (duplicateLogResult.isErr()) {
      return Result.err(duplicateLogResult.error);
    }

    return Result.err(
      new DuplicateRuntimeStartError(paths, existingRecord.value.pid)
    );
  }

  const staleLockLogResult = await writeLogMessage(
    options.logWriter,
    `[runtime] removing stale lifecycle lock dataDir=${paths.dataDir} existingPid=${existingRecord.isOk() ? existingRecord.value.pid : "unknown"}`
  );
  if (staleLockLogResult.isErr()) {
    return Result.err(staleLockLogResult.error);
  }

  const [removeLockResult, removePidResult] = await Promise.all([
    removeIfPresent(paths.lockPath),
    removeIfPresent(paths.pidPath),
  ]);
  if (removeLockResult.isErr()) {
    return Result.err(removeLockResult.error);
  }
  if (removePidResult.isErr()) {
    return Result.err(removePidResult.error);
  }

  const replacementWriteResult = await writeNewLock(paths.lockPath, record);
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

  return Result.ok({
    isProcessRunning:
      options.isProcessRunning ?? defaultLifecycleOptions.isProcessRunning,
    launchId: launchId.data,
    logWriter: options.logWriter ?? defaultLifecycleOptions.logWriter,
    now: options.now ?? defaultLifecycleOptions.now,
    pid: options.pid ?? defaultLifecycleOptions.pid,
  });
}

async function writeNewLock(
  path: string,
  record: RuntimeLockRecord
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  const handleResult = await Result.tryPromise({
    try: async () => open(path, "wx", 0o600),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message: `failed to create runtime lock file at ${path}`,
        operation: "open",
        path,
      }),
  });
  if (handleResult.isErr()) {
    return Result.err(handleResult.error);
  }

  const handle = handleResult.value;
  const writeResult = await Result.tryPromise({
    try: async () => handle.writeFile(`${JSON.stringify(record)}\n`, "utf8"),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message: `failed to write runtime lock file at ${path}`,
        operation: "write",
        path,
      }),
  });
  const closeResult = await Result.tryPromise({
    try: async () => handle.close(),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message: `failed to close runtime lock file at ${path}`,
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

async function readLockRecord(
  path: string
): Promise<
  ResultType<
    RuntimeLockRecord,
    RuntimeLifecycleFileError | RuntimeLockRecordReadError
  >
> {
  return Result.gen(async function* readLockRecordFlow() {
    const contents = yield* Result.await(
      readLifecycleFile(path, `failed to read runtime lock record at ${path}`)
    );
    const parsed = yield* Result.try({
      try: () => JSON.parse(contents),
      catch: (cause) =>
        new RuntimeLockRecordReadError({
          cause,
          message: `invalid runtime lock record at ${path}`,
          path,
        }),
    });

    return decodeRuntimeLockRecord(parsed, path);
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
    removeIfPresent(runtimeStatePath(paths)),
    removeIfPresent(paths.pidPath),
  ]);
  await removeIfPresent(paths.lockPath);
}
