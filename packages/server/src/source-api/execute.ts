import { authorizeSourceApi } from "./authorize";
import { describeSourceApi } from "./describe";
import { normalizeSourceApiRequest } from "./normalize";
import { getSourceApiAdapter, sourceApiRegistry } from "./registry";
import type { SourceApiRegistry } from "./registry";
import type {
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiExecuteRequest,
  SourceApiExecutionResponse,
} from "./types";

export async function executeSourceApi(input: {
  source: PreparedSourceConnection;
  actor: SourceApiActorContext;
  request: SourceApiExecuteRequest;
  registry?: SourceApiRegistry;
}): Promise<SourceApiExecutionResponse> {
  const registry = input.registry ?? sourceApiRegistry;
  const descriptor = await describeSourceApi({
    actor: input.actor,
    registry,
    source: input.source,
  });
  const plan = await normalizeSourceApiRequest({
    actor: input.actor,
    descriptor,
    registry,
    request: input.request,
    source: input.source,
  });

  await authorizeSourceApi({
    actor: input.actor,
    plan,
  });

  const adapter = getSourceApiAdapter(registry, input.source.provider);
  return adapter.execute({
    actor: input.actor,
    plan,
    source: input.source,
  });
}
