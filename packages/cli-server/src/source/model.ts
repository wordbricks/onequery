import { isDatabaseCredentialProviderType } from "@onequery/db/server";
import type {
  DatabaseCredentialProviderType,
  DataSourceStatus,
  ProviderType,
} from "@onequery/db/server";
import { sourceApiRegistry } from "@onequery/server/source-api";

import type {
  CliQuerySourceRecord,
  CliSourceRecord,
} from "../domain/workflows";
import { isCliSourceKey } from "../identifiers";

// @onequery/db's analysis source providers include non-SQL relays like GitHub
// and analytics sources. CLI query intentionally maps only database credential
// providers to the `query` source interface.

type CliSourceInterfaceType = "query" | "api";

// The backing table still stores the CLI-visible source identity in
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

export function sortCliSourceRecords(
  sources: CliSourceRecord[]
): CliSourceRecord[] {
  return [...sources].sort((left, right) => {
    const bySourceKey = left.sourceKey.localeCompare(right.sourceKey);
    if (bySourceKey !== 0) {
      return bySourceKey;
    }

    return left.provider.localeCompare(right.provider);
  });
}

export function getCliQueryDatabaseProviderType(
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

export function getCliSourceInterfaceTypes(
  provider: ProviderType,
  status: DataSourceStatus
): CliSourceInterfaceType[] {
  if (status !== "active") {
    return [];
  }

  const interfaces: CliSourceInterfaceType[] = [];
  if (getCliQueryDatabaseProviderType(provider, status) !== null) {
    interfaces.push("query");
  }
  if (sourceApiRegistry.get(provider) !== null) {
    interfaces.push("api");
  }

  return interfaces;
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
