import { DATA_SOURCE_STATUS, PROVIDER_TYPES } from "@onequery/db/server";
import type { DataSourceStatus, ProviderType } from "@onequery/db/server";
import { z } from "zod";

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

export const QueryActionSourceDescriptorSchema = z
  .object({
    displayName: z.string().nullable(),
    name: z.string(),
    organizationId: z.string(),
    provider: z.enum(PROVIDER_TYPES),
    sourceId: z.string(),
    sourceKey: z.string(),
    sourceStatus: z.enum(DATA_SOURCE_STATUS),
  })
  .strict();
