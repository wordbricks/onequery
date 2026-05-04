import type { DataSourceStatus, ProviderType } from "@onequery/db/server";

export const QUERY_ACTION_MODES = ["validate", "execute"] as const;
export type QueryActionMode = (typeof QUERY_ACTION_MODES)[number];

export type QueryActionSourceDescriptor = {
  displayName: string | null;
  name: string;
  organizationId: string;
  provider: ProviderType;
  sourceId: string;
  sourceKey: string;
  sourceStatus: DataSourceStatus;
};
