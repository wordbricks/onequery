import type { ProviderType } from "@onequery/db/server";

import { airtableSourceApiAdapter } from "./adapters/airtable";
import { amplitudeSourceApiAdapter } from "./adapters/amplitude";
import { bigQuerySourceApiAdapter } from "./adapters/bigquery";
import { calSourceApiAdapter } from "./adapters/cal";
import { cloudflareWorkersObservabilitySourceApiAdapter } from "./adapters/cloudflare-workers-observability";
import { discordSourceApiAdapter } from "./adapters/discord";
import { googleAnalyticsSourceApiAdapter } from "./adapters/ga";
import { githubSourceApiAdapter } from "./adapters/github";
import { granolaSourceApiAdapter } from "./adapters/granola";
import { mixpanelSourceApiAdapter } from "./adapters/mixpanel";
import { mongodbSourceApiAdapter } from "./adapters/mongodb";
import { postHogSourceApiAdapter } from "./adapters/posthog";
import { sentrySourceApiAdapter } from "./adapters/sentry";
import {
  SourceApiAdapterNotRegisteredError,
  SourceApiRegistryConfigurationError,
} from "./errors";
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
      throw new SourceApiRegistryConfigurationError(adapter.provider);
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
    throw new SourceApiAdapterNotRegisteredError(provider);
  }

  return adapter;
}

export const sourceApiRegistry = createSourceApiRegistry([
  amplitudeSourceApiAdapter,
  airtableSourceApiAdapter,
  bigQuerySourceApiAdapter,
  calSourceApiAdapter,
  cloudflareWorkersObservabilitySourceApiAdapter,
  discordSourceApiAdapter,
  googleAnalyticsSourceApiAdapter,
  githubSourceApiAdapter,
  granolaSourceApiAdapter,
  mixpanelSourceApiAdapter,
  mongodbSourceApiAdapter,
  postHogSourceApiAdapter,
  sentrySourceApiAdapter,
]);
