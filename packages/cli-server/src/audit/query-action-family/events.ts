import { DATA_SOURCE_STATUS, PROVIDER_TYPES } from "@onequery/db/server";
import type { DataSourceStatus, ProviderType } from "@onequery/db/server";
import { z } from "zod";

import type { WorkflowCommittedEvent } from "../kernel";
import {
  QUERY_ACTION_MODES,
  QueryActionSourceDescriptorSchema,
} from "./descriptors";
import type {
  QueryActionMode,
  QueryActionSourceDescriptor,
} from "./descriptors";

export type QueryActionEvent =
  | {
      queryMode: QueryActionMode;
      queryText: string;
      type: "action_received";
    }
  | {
      source: QueryActionSourceDescriptor;
      type: "source_loaded";
    }
  | {
      sourceKey: string;
      type: "source_not_found";
    }
  | {
      provider: ProviderType;
      sourceStatus: DataSourceStatus;
      type: "source_not_queryable";
    }
  | {
      type: "query_validated";
      validatedQuery: string;
    }
  | {
      detail: string;
      type: "query_rejected";
    }
  | {
      type: "credentials_loaded";
    }
  | {
      detail: string;
      hint: string;
      type: "query_preparation_failed";
    }
  | {
      elapsedMs: number;
      rowCount: number;
      type: "query_executed";
    }
  | {
      detail: string;
      type: "query_unavailable";
    }
  | {
      detail: string;
      type: "query_timed_out";
    }
  | {
      detail: string;
      type: "query_execution_failed";
    }
  | {
      type: "usage_persisted";
    }
  | {
      detail: string;
      type: "usage_persist_failed";
    };

export const QueryActionEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      queryMode: z.enum(QUERY_ACTION_MODES),
      queryText: z.string(),
      type: z.literal("action_received"),
    })
    .strict(),
  z
    .object({
      source: QueryActionSourceDescriptorSchema,
      type: z.literal("source_loaded"),
    })
    .strict(),
  z
    .object({
      sourceKey: z.string(),
      type: z.literal("source_not_found"),
    })
    .strict(),
  z
    .object({
      provider: z.enum(PROVIDER_TYPES),
      sourceStatus: z.enum(DATA_SOURCE_STATUS),
      type: z.literal("source_not_queryable"),
    })
    .strict(),
  z
    .object({
      type: z.literal("query_validated"),
      validatedQuery: z.string(),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("query_rejected"),
    })
    .strict(),
  z
    .object({
      type: z.literal("credentials_loaded"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      hint: z.string(),
      type: z.literal("query_preparation_failed"),
    })
    .strict(),
  z
    .object({
      elapsedMs: z.number(),
      rowCount: z.number(),
      type: z.literal("query_executed"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("query_unavailable"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("query_timed_out"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("query_execution_failed"),
    })
    .strict(),
  z
    .object({
      type: z.literal("usage_persisted"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("usage_persist_failed"),
    })
    .strict(),
]);

export type QueryActionCommittedEvent =
  WorkflowCommittedEvent<QueryActionEvent>;
