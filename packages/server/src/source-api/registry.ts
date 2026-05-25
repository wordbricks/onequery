import type { ProviderType } from "@onequery/db/server";

import { airtableSourceApiAdapter } from "./adapters/airtable";
import { amazonAdsSourceApiAdapter } from "./adapters/amazon-ads";
import { amplitudeSourceApiAdapter } from "./adapters/amplitude";
import { bigQuerySourceApiAdapter } from "./adapters/bigquery";
import { calSourceApiAdapter } from "./adapters/cal";
import { cloudflareWorkersObservabilitySourceApiAdapter } from "./adapters/cloudflare-workers-observability";
import { confluenceSourceApiAdapter } from "./adapters/confluence";
import { discordSourceApiAdapter } from "./adapters/discord";
import { googleAnalyticsSourceApiAdapter } from "./adapters/ga";
import { githubSourceApiAdapter } from "./adapters/github";
import { googleSearchConsoleSourceApiAdapter } from "./adapters/google-search-console";
import { granolaSourceApiAdapter } from "./adapters/granola";
import { jiraSourceApiAdapter } from "./adapters/jira";
import { linkedInAdsSourceApiAdapter } from "./adapters/linkedin-ads";
import { mixpanelSourceApiAdapter } from "./adapters/mixpanel";
import { mongodbSourceApiAdapter } from "./adapters/mongodb";
import { postHogSourceApiAdapter } from "./adapters/posthog";
import { sendGridSourceApiAdapter } from "./adapters/sendgrid";
import { sentrySourceApiAdapter } from "./adapters/sentry";
import { tiktokMarketingSourceApiAdapter } from "./adapters/tiktok-marketing";
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
  amazonAdsSourceApiAdapter,
  airtableSourceApiAdapter,
  bigQuerySourceApiAdapter,
  calSourceApiAdapter,
  cloudflareWorkersObservabilitySourceApiAdapter,
  confluenceSourceApiAdapter,
  discordSourceApiAdapter,
  googleAnalyticsSourceApiAdapter,
  githubSourceApiAdapter,
  googleSearchConsoleSourceApiAdapter,
  granolaSourceApiAdapter,
  jiraSourceApiAdapter,
  linkedInAdsSourceApiAdapter,
  mixpanelSourceApiAdapter,
  mongodbSourceApiAdapter,
  postHogSourceApiAdapter,
  sendGridSourceApiAdapter,
  sentrySourceApiAdapter,
  tiktokMarketingSourceApiAdapter,
]);
