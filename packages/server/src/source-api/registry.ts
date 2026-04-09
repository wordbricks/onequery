import type { ProviderType } from "@onequery/db/server";

import { googleAnalyticsSourceApiAdapter } from "./adapters/ga";
import { githubSourceApiAdapter } from "./adapters/github";
import type { SourceApiAdapter } from "./types";

export type SourceApiRegistry = {
  adapters: ReadonlyMap<ProviderType, SourceApiAdapter>;
  get(provider: ProviderType): SourceApiAdapter | null;
};

export function createSourceApiRegistry(
  adapters: readonly SourceApiAdapter[]
): SourceApiRegistry {
  const registry = new Map<ProviderType, SourceApiAdapter>();

  for (const adapter of adapters) {
    if (registry.has(adapter.provider)) {
      throw new Error(
        `Duplicate source API adapter registration for provider "${adapter.provider}"`
      );
    }
    registry.set(adapter.provider, adapter);
  }

  return {
    adapters: registry,
    get(provider) {
      return registry.get(provider) ?? null;
    },
  };
}

export function getSourceApiAdapter(
  registry: SourceApiRegistry,
  provider: ProviderType
): SourceApiAdapter {
  const adapter = registry.get(provider);
  if (!adapter) {
    throw new Error(
      `No source API adapter is registered for provider "${provider}"`
    );
  }

  return adapter;
}

export const sourceApiRegistry = createSourceApiRegistry([
  googleAnalyticsSourceApiAdapter,
  githubSourceApiAdapter,
]);
