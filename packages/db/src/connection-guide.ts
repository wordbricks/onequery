import type { ProviderType } from "./schema/data-sources";
import {
  SOURCE_PROVIDER_IDS,
  SOURCE_PROVIDER_REGISTRY,
} from "./source-providers";

export type SourceConnectProviderGuide = {
  provider: ProviderType;
  summary: string;
  steps: string[];
  exampleInput: Record<string, unknown>;
};

export const SOURCE_CONNECT_PROVIDER_GUIDES: SourceConnectProviderGuide[] =
  SOURCE_PROVIDER_IDS.map((provider) => {
    const guide = SOURCE_PROVIDER_REGISTRY[provider].guide;

    return {
      provider,
      summary: guide.summary,
      steps: [...guide.steps],
      exampleInput: {
        ...guide.exampleInput,
        credentials: { ...guide.exampleInput.credentials },
      },
    };
  });

export function sourceConnectProviderGuide(
  provider: ProviderType
): SourceConnectProviderGuide {
  const guide = SOURCE_CONNECT_PROVIDER_GUIDES.find(
    (entry) => entry.provider === provider
  );
  if (!guide) {
    throw new Error(`unsupported source connect provider: ${provider}`);
  }
  return guide;
}
