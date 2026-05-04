import { join } from "node:path";

import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import { RuntimeLifecycleLogWriteError } from "./errors";
import type { AppendLifecycleLogError } from "./errors";
import { appendLifecycleFile, ensureRuntimeDirectory } from "./files";
import type { LifecycleLogWriter, SelfHostLifecyclePaths } from "./types";

async function appendLifecycleLogResult(
  paths: SelfHostLifecyclePaths,
  message: string,
  now: () => Date = () => new Date()
): Promise<ResultType<void, AppendLifecycleLogError>> {
  const ensureLogsDirResult = await ensureRuntimeDirectory(paths.logsDir);
  if (ensureLogsDirResult.isErr()) {
    return Result.err(ensureLogsDirResult.error);
  }

  return appendLifecycleFile(
    join(paths.logsDir, "server.log"),
    `${formatTimestamp(now())} ${message}\n`,
    `failed to append lifecycle log at ${join(paths.logsDir, "server.log")}`
  );
}

export async function appendLifecycleLog(
  paths: SelfHostLifecyclePaths,
  message: string,
  now: () => Date = () => new Date()
): Promise<void> {
  const appendResult = await appendLifecycleLogResult(paths, message, now);

  if (appendResult.isErr()) {
    throw appendResult.error;
  }
}

export async function writeLogMessage(
  logWriter: LifecycleLogWriter,
  message: string
): Promise<ResultType<void, RuntimeLifecycleLogWriteError>> {
  return Result.tryPromise({
    try: async () => {
      await logWriter.append(message);
    },
    catch: (cause) =>
      new RuntimeLifecycleLogWriteError({
        cause,
        message: `failed to append lifecycle log line: ${message}`,
      }),
  }).then((result) => result.map(() => undefined));
}

function formatTimestamp(value: Date): string {
  return value.toISOString();
}
