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
  value: string
): CliSourceSelector | null {
  const reference = parseCliSourceReference(value);
  if (!reference) {
    return null;
  }

  return {
    sourceKey: reference.sourceKey,
    sourceProvider: reference.provider,
  };
}
