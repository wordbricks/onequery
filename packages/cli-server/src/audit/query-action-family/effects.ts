import { z } from "zod";

import { QueryActionSourceDescriptorSchema } from "./descriptors";
import type { QueryActionSourceDescriptor } from "./descriptors";

export type QueryActionEffect =
  | {
      organizationId: string;
      sourceKey: string;
      type: "load_source";
    }
  | {
      queryText: string;
      source: QueryActionSourceDescriptor;
      type: "validate_query";
    }
  | {
      source: QueryActionSourceDescriptor;
      type: "load_credentials";
    }
  | {
      source: QueryActionSourceDescriptor;
      type: "execute_query";
      validatedQuery: string;
    }
  | {
      sourceId: string;
      type: "persist_usage";
    };

export const QueryActionEffectSchema = z.discriminatedUnion("type", [
  z
    .object({
      organizationId: z.string(),
      sourceKey: z.string(),
      type: z.literal("load_source"),
    })
    .strict(),
  z
    .object({
      queryText: z.string(),
      source: QueryActionSourceDescriptorSchema,
      type: z.literal("validate_query"),
    })
    .strict(),
  z
    .object({
      source: QueryActionSourceDescriptorSchema,
      type: z.literal("load_credentials"),
    })
    .strict(),
  z
    .object({
      source: QueryActionSourceDescriptorSchema,
      type: z.literal("execute_query"),
      validatedQuery: z.string(),
    })
    .strict(),
  z
    .object({
      sourceId: z.string(),
      type: z.literal("persist_usage"),
    })
    .strict(),
]);
