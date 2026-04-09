import { getSourceApiAdapter, sourceApiRegistry } from "./registry";
import type { SourceApiRegistry } from "./registry";
import type {
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiDescriptor,
} from "./types";

export async function describeSourceApi(input: {
  source: PreparedSourceConnection;
  actor: SourceApiActorContext;
  registry?: SourceApiRegistry;
}): Promise<SourceApiDescriptor> {
  const registry = input.registry ?? sourceApiRegistry;
  const adapter = getSourceApiAdapter(registry, input.source.provider);

  return adapter.describe({
    actor: input.actor,
    source: input.source,
  });
}
