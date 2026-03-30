import { isDatabaseCredentialProviderType } from "@onequery/db/server";
import type {
  DatabaseCredentialProviderType,
  DataSourceStatus,
  ProviderType,
} from "@onequery/db/server";

import type {
  CliQuerySourceRecord,
  CliSourceListResult,
  CliSourceRecord,
  CliSourceSummary,
} from "../domain/workflows";
import { createCliProblem } from "../error";
import { isCliSourceKey } from "../identifiers";

// Comment: @onequery/db's QUERYABLE_PROVIDER_TYPES also includes non-SQL relays
// like GitHub and analytics sources. CLI v1 query is intentionally narrower and
// only treats database credential providers as queryable.

export function sourceNotFoundProblem(orgSlug: string, sourceKey: string) {
  return createCliProblem({
    detail: `no source named "${sourceKey}" exists in org "${orgSlug}"`,
    key: "SOURCE_NOT_FOUND",
  });
}

// Comment: the backing table still stores the CLI-visible source identity in
// data_sources.name. The CLI domain treats that normalized org-unique name as
// the canonical sourceKey so the rest of the workflow code never reaches for
// raw table field names.
export function createCliSourceKey(name: string): string | null {
  const normalized = name.trim();
  return normalized.length > 0 && isCliSourceKey(normalized)
    ? normalized
    : null;
}

export function createCliSourceRecord(input: {
  id: string;
  name: string;
  provider: ProviderType;
  status: DataSourceStatus;
  displayName?: string | null;
}): CliSourceRecord | null {
  const sourceKey = createCliSourceKey(input.name);
  if (!sourceKey) {
    return null;
  }

  return {
    displayName: normalizeSourceDisplayName(input.displayName),
    id: input.id,
    provider: input.provider,
    sourceKey,
    status: input.status,
  };
}

export function createCliQuerySourceRecord(input: {
  id: string;
  name: string;
  organizationId: string;
  provider: ProviderType;
  status: DataSourceStatus;
  credentialsEncrypted: string;
  credentialsIv: string;
  displayName?: string | null;
}): CliQuerySourceRecord | null {
  const source = createCliSourceRecord(input);
  if (!source) {
    return null;
  }

  return {
    ...source,
    credentialsEncrypted: input.credentialsEncrypted,
    credentialsIv: input.credentialsIv,
    name: input.name,
    organizationId: input.organizationId,
  };
}

export function buildCliSourceSummary(
  source: CliSourceRecord
): CliSourceSummary {
  return {
    displayName: source.displayName,
    name: source.sourceKey,
    provider: source.provider,
    queryable: isCliSourceQueryable(source.provider, source.status),
    status: source.status,
  };
}

export function buildCliSourceListResult(
  sources: CliSourceRecord[]
): CliSourceListResult {
  return {
    sources: sortCliSourceSummaries(sources.map(buildCliSourceSummary)),
  };
}

function sortCliSourceSummaries(
  sources: CliSourceSummary[]
): CliSourceSummary[] {
  return [...sources].toSorted((left, right) => {
    const bySourceKey = left.name.localeCompare(right.name);
    if (bySourceKey !== 0) {
      return bySourceKey;
    }

    return left.provider.localeCompare(right.provider);
  });
}

function isCliSourceQueryable(
  provider: ProviderType,
  status: DataSourceStatus
): boolean {
  return getCliQueryableDatabaseProviderType(provider, status) !== null;
}

export function getCliQueryableDatabaseProviderType(
  provider: ProviderType,
  status: DataSourceStatus
): DatabaseCredentialProviderType | null {
  if (status !== "active") {
    return null;
  }

  if (provider === "supabase") {
    return "postgres";
  }

  return isDatabaseCredentialProviderType(provider) ? provider : null;
}

function normalizeSourceDisplayName(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
