import { authorizeSourceApi } from "./authorize";
import { readSourceApiErrorMessage } from "./errors";
import { getSourceApiAdapter, sourceApiRegistry } from "./registry";
import type { SourceApiRegistry } from "./registry";
import type {
  PreparedSourceApi,
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiContinuationState,
  SourceApiExecutionResult,
} from "./types";

export type SourceApiExecutionStage = "authorize" | "execute";

export class SourceApiExecutionStageError extends Error {
  override readonly cause: unknown;
  readonly stage: SourceApiExecutionStage;

  constructor(stage: SourceApiExecutionStage, cause: unknown) {
    super(readSourceApiErrorMessage(cause), {
      cause: cause instanceof Error ? cause : undefined,
    });
    this.name = "SourceApiExecutionStageError";
    this.cause = cause;
    this.stage = stage;
  }
}

export async function executePreparedSourceApi(input: {
  source: PreparedSourceConnection;
  actor: SourceApiActorContext;
  prepared: PreparedSourceApi;
  continuation?: SourceApiContinuationState;
  registry?: SourceApiRegistry;
}): Promise<SourceApiExecutionResult> {
  const registry = input.registry ?? sourceApiRegistry;

  await Promise.resolve()
    .then(() =>
      authorizeSourceApi({
        actor: input.actor,
        prepared: input.prepared,
      })
    )
    .catch((error: unknown) => {
      throw toSourceApiExecutionStageError("authorize", error);
    });

  const adapter = getSourceApiAdapter(registry, input.source.provider);
  return Promise.resolve()
    .then(() =>
      adapter.execute({
        actor: input.actor,
        continuation: input.continuation,
        prepared: input.prepared,
        source: input.source,
      })
    )
    .catch((error: unknown) => {
      throw toSourceApiExecutionStageError("execute", error);
    });
}

function toSourceApiExecutionStageError(
  stage: SourceApiExecutionStage,
  error: unknown
): SourceApiExecutionStageError {
  if (error instanceof SourceApiExecutionStageError) {
    return error;
  }

  return new SourceApiExecutionStageError(stage, error);
}
