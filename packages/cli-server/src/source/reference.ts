import { isSourceProviderId } from "@onequery/db/server";
import type { ProviderType } from "@onequery/db/server";

import { isCliSourceKey } from "../identifiers";

export type CliSourceReference = {
  provider: ProviderType;
  sourceKey: string;
};

export type CliSourceSelector = {
  sourceKey: string;
  sourceProvider: ProviderType;
};

type CliSourceSelectorInput =
  | {
      provider?: string;
      sourceKey?: string;
    }
  | null
  | undefined;

export function formatCliSourceReference(
  provider: ProviderType,
  sourceKey: string
): string {
  if (sourceKey.includes("://")) {
    return sourceKey;
  }

  return `${provider}://${sourceKey}`;
}

export function parseCliSourceReference(
  value: string
): CliSourceReference | null {
  const trimmed = value.trim();
  const [provider, sourceKey, extra] = trimmed.split("://");
  if (
    extra !== undefined ||
    !provider ||
    !sourceKey ||
    !isSourceProviderId(provider) ||
    !isCliSourceKey(sourceKey)
  ) {
    return null;
  }

  return {
    provider,
    sourceKey,
  };
}

export function parseCliSourceSelector(
  value: CliSourceSelectorInput
): CliSourceSelector | null {
  if (
    !value ||
    !value.provider ||
    !value.sourceKey ||
    !isSourceProviderId(value.provider) ||
    !isCliSourceKey(value.sourceKey)
  ) {
    return null;
  }

  return {
    sourceKey: value.sourceKey,
    sourceProvider: value.provider,
  };
}
