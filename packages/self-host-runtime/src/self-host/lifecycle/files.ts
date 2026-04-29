import {
  appendFile,
  mkdir,
  readFile,
  rm,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import {
  RuntimeLifecycleDirectoryError,
  RuntimeLifecycleFileError,
} from "./errors";
import type { SelfHostLifecyclePaths } from "./types";

export async function ensureRuntimeDirectories(
  paths: SelfHostLifecyclePaths
): Promise<ResultType<void, RuntimeLifecycleDirectoryError>> {
  const ensurePathResults = await Promise.all(
    [
      ...new Set([
        paths.dataDir,
        paths.logsDir,
        dirname(paths.lifecycleEventLogPath),
        dirname(paths.runtimeLeasePath),
        dirname(paths.runtimeStatusSnapshotPath),
      ]),
    ].map((path) => ensureRuntimeDirectory(path))
  );

  for (const ensurePathResult of ensurePathResults) {
    if (ensurePathResult.isErr()) {
      return Result.err(ensurePathResult.error);
    }
  }

  return Result.ok(undefined);
}

export async function ensureRuntimeDirectory(
  path: string
): Promise<ResultType<void, RuntimeLifecycleDirectoryError>> {
  return Result.tryPromise({
    try: async () =>
      mkdir(path, {
        recursive: true,
        mode: 0o700,
      }),
    catch: (cause) =>
      new RuntimeLifecycleDirectoryError({
        cause,
        message: `failed to ensure runtime directory ${path}`,
        path,
      }),
  }).then((result) => result.map(() => undefined));
}

export async function readLifecycleFile(
  path: string,
  message: string
): Promise<ResultType<string, RuntimeLifecycleFileError>> {
  return Result.tryPromise({
    try: async () => readFile(path, "utf8"),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message,
        operation: "read",
        path,
      }),
  });
}

export async function writeRuntimeStatusSnapshot(
  paths: SelfHostLifecyclePaths,
  contents: string
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  return replaceFileWithCompleteContents(
    paths.runtimeStatusSnapshotPath,
    contents,
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );
}

export async function replaceFileWithCompleteContents(
  path: string,
  contents: string,
  options: {
    encoding: "utf8";
    mode: number;
  }
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);

  const writeTempResult = await writeLifecycleFile(
    tempPath,
    contents,
    "write",
    `failed to write temp lifecycle file at ${tempPath}`,
    options
  );
  if (writeTempResult.isErr()) {
    return Result.err(writeTempResult.error);
  }

  const initialRenameResult = await renameLifecycleFile(
    tempPath,
    path,
    `failed to replace lifecycle file at ${path}`
  );
  if (initialRenameResult.isOk()) {
    return Result.ok(undefined);
  }

  // Comment: rewrite through a sibling temp file so readers never observe a
  // truncated JSON document while the runtime updates lifecycle state.
  const removeTargetResult = await removeIfPresent(path);
  if (removeTargetResult.isErr()) {
    return Result.err(removeTargetResult.error);
  }

  const replacementRenameResult = await renameLifecycleFile(
    tempPath,
    path,
    `failed to replace lifecycle file at ${path}`
  );
  if (replacementRenameResult.isErr()) {
    await removeIfPresent(tempPath);
    return Result.err(replacementRenameResult.error);
  }

  return Result.ok(undefined);
}

export async function writeLifecycleFile(
  path: string,
  contents: string,
  operation: RuntimeLifecycleFileError["operation"],
  message: string,
  options: {
    encoding: "utf8";
    mode?: number;
  }
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  return Result.tryPromise({
    try: async () => writeFile(path, contents, options),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message,
        operation,
        path,
      }),
  }).then((result) => result.map(() => undefined));
}

export async function appendLifecycleFile(
  path: string,
  contents: string,
  message: string
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  return Result.tryPromise({
    try: async () => appendFile(path, contents, "utf8"),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message,
        operation: "append",
        path,
      }),
  }).then((result) => result.map(() => undefined));
}

export async function renameLifecycleFile(
  fromPath: string,
  toPath: string,
  message: string
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  return Result.tryPromise({
    try: async () => rename(fromPath, toPath),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message,
        operation: "rename",
        path: toPath,
      }),
  }).then((result) => result.map(() => undefined));
}

export async function removeIfPresent(
  path: string
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  return Result.tryPromise({
    try: async () => rm(path, { force: true }),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message: `failed to remove lifecycle file at ${path}`,
        operation: "remove",
        path,
      }),
  }).then((result) => result.map(() => undefined));
}
