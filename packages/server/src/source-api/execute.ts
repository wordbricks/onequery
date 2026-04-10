import { authorizeSourceApi } from "./authorize";
import { describeSourceApi } from "./describe";
import { readSourceApiErrorMessage } from "./errors";
import { normalizeSourceApiRequest } from "./normalize";
import { getSourceApiAdapter, sourceApiRegistry } from "./registry";
import type { SourceApiRegistry } from "./registry";
import type {
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiExecuteRequest,
  SourceApiExecutionResponse,
} from "./types";

export type SourceApiExecutionStage = "normalize" | "authorize" | "execute";

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

export async function executeSourceApi(input: {
  source: PreparedSourceConnection;
  actor: SourceApiActorContext;
  request: SourceApiExecuteRequest;
  registry?: SourceApiRegistry;
}): Promise<SourceApiExecutionResponse> {
  const registry = input.registry ?? sourceApiRegistry;
  const descriptor = await Promise.resolve()
    .then(() =>
      describeSourceApi({
        actor: input.actor,
        registry,
        source: input.source,
      })
    )
    .catch((error: unknown) => {
      throw toSourceApiExecutionStageError("normalize", error);
    });
  const plan = await Promise.resolve()
    .then(() =>
      normalizeSourceApiRequest({
        actor: input.actor,
        descriptor,
        registry,
        request: input.request,
        source: input.source,
      })
    )
    .catch((error: unknown) => {
      throw toSourceApiExecutionStageError("normalize", error);
    });

  await Promise.resolve()
    .then(() =>
      authorizeSourceApi({
        actor: input.actor,
        plan,
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
        plan,
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
