import type { DataSourceStatus, ProviderType } from "@onequery/db/server";

import type { CliSelectedFields } from "../read-controls";

type CliTransportSourceSummary = {
  name?: string;
  displayName?: string | null;
  provider?: ProviderType;
  queryable?: boolean;
  status?: DataSourceStatus;
};

type CliTransportSourceScope = "source" | "sources" | null;

export function projectCliSourceSummary<T extends CliTransportSourceSummary>(
  source: T,
  selectedFields: CliSelectedFields,
  scope: CliTransportSourceScope = null
): T {
  if (!selectedFields || (scope !== null && selectedFields.has(scope))) {
    return source;
  }

  const projected: CliTransportSourceSummary = {};

  if (selectedFields.has(resolveSourceField(scope, "name"))) {
    projected.name = source.name;
  }

  if (selectedFields.has(resolveSourceField(scope, "displayName"))) {
    projected.displayName = source.displayName ?? null;
  }

  if (selectedFields.has(resolveSourceField(scope, "provider"))) {
    projected.provider = source.provider;
  }

  if (selectedFields.has(resolveSourceField(scope, "queryable"))) {
    projected.queryable = source.queryable;
  }

  if (selectedFields.has(resolveSourceField(scope, "status"))) {
    projected.status = source.status;
  }

  return projected as T;
}

function resolveSourceField(
  scope: CliTransportSourceScope,
  field: keyof CliTransportSourceSummary
): string {
  return scope === null ? field : `${scope}.${field}`;
}
