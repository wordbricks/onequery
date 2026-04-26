import type { ChildProcess } from "node:child_process";
import type { Stats } from "node:fs";
import { statSync } from "node:fs";

import { unreachable } from "antiox/panic";
import { sleep } from "antiox/time";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

type RuntimeAssetStager = (options: { runtimeRoot: string }) => Promise<void>;

export class WorkspaceDevRuntimeAssetStagingError extends TaggedError(
  "WorkspaceDevRuntimeAssetStagingError"
)<{
  cause: unknown;
  message: string;
  runtimeRoot: string;
}>() {}

export class BundledRuntimeWaitError extends TaggedError(
  "BundledRuntimeWaitError"
)<{
  bundledRuntimePath: string;
  cause?: unknown;
  message: string;
}>() {}

export type WorkspaceDevRuntimePreparationError =
  | WorkspaceDevRuntimeAssetStagingError
  | BundledRuntimeWaitError;

type WaitForBundledRuntimeInput = {
  buildStartedAtMs: number;
  builder: ChildProcess;
  bundledRuntimePath: string;
  pollIntervalMs?: number;
  statBundledRuntimePath?: (
    bundledRuntimePath: string
  ) => Pick<Stats, "isFile" | "mtimeMs"> | undefined;
  timeoutMs?: number;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statBundledRuntimePath(
  bundledRuntimePath: string
): Pick<Stats, "isFile" | "mtimeMs"> | undefined {
  return statSync(bundledRuntimePath, {
    throwIfNoEntry: false,
  });
}

export async function stageWorkspaceDevRuntimeAssetsResult(
  runtimeRoot: string,
  stageRuntimeAssets: RuntimeAssetStager
): Promise<ResultType<void, WorkspaceDevRuntimeAssetStagingError>> {
  return Result.tryPromise({
    try: async () => {
      await stageRuntimeAssets({ runtimeRoot });
    },
    catch: (cause) =>
      new WorkspaceDevRuntimeAssetStagingError({
        cause,
        message: `Failed to stage self-host runtime assets (dev): ${toErrorMessage(cause)}`,
        runtimeRoot,
      }),
  });
}

export async function waitForBundledRuntimeResult({
  buildStartedAtMs,
  builder,
  bundledRuntimePath,
  pollIntervalMs = 50,
  statBundledRuntimePath: statRuntimeBundle = statBundledRuntimePath,
  timeoutMs = 15_000,
}: WaitForBundledRuntimeInput): Promise<
  ResultType<void, BundledRuntimeWaitError>
> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (builder.exitCode !== null || builder.signalCode !== null) {
      return Result.err(
        new BundledRuntimeWaitError({
          bundledRuntimePath,
          message:
            "Runtime bundle build exited before the Node entry was ready.",
        })
      );
    }

    const bundleStatsResult = Result.try({
      try: () => statRuntimeBundle(bundledRuntimePath),
      catch: (cause) =>
        new BundledRuntimeWaitError({
          bundledRuntimePath,
          cause,
          message: `Failed to inspect bundled self-host runtime entry at ${bundledRuntimePath}.\n${toErrorMessage(cause)}`,
        }),
    });
    if (bundleStatsResult.isErr()) {
      return Result.err(bundleStatsResult.error);
    }

    const bundleStats = bundleStatsResult.value;
    if (bundleStats?.isFile() && bundleStats.mtimeMs >= buildStartedAtMs) {
      return Result.ok();
    }

    // Comment: the first watch build has not emitted the bundle yet.
    await sleep(pollIntervalMs);
  }

  return Result.err(
    new BundledRuntimeWaitError({
      bundledRuntimePath,
      message: `Timed out waiting for bundled self-host runtime entry at ${bundledRuntimePath}.`,
    })
  );
}

export function renderWorkspaceDevRuntimePreparationError(
  error: WorkspaceDevRuntimePreparationError
): string {
  switch (error._tag) {
    case "WorkspaceDevRuntimeAssetStagingError":
    case "BundledRuntimeWaitError":
      return error.message;
    default:
      return unreachable(error);
  }
}
