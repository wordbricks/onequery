import { z } from "zod";

import {
  SourceApiActionRequestDescriptorSchema,
  SourceApiActionSourceDescriptorSchema,
} from "./descriptors";
import type {
  SourceApiActionRequestDescriptor,
  SourceApiActionSourceDescriptor,
} from "./descriptors";

export type SourceApiActionEffect =
  | {
      organizationId: string;
      sourceKey: string;
      type: "load_source";
    }
  | {
      source: SourceApiActionSourceDescriptor;
      type: "resolve_descriptor";
    }
  | {
      requestDescriptor: SourceApiActionRequestDescriptor;
      source: SourceApiActionSourceDescriptor;
      type: "prepare_request";
    }
  | {
      attemptNumber: number;
      pageIndex: number;
      preparedRequestFingerprint: string;
      requestDescriptor: SourceApiActionRequestDescriptor;
      source: SourceApiActionSourceDescriptor;
      type: "execute_page";
    };

export const SourceApiActionEffectSchema = z.discriminatedUnion("type", [
  z
    .object({
      organizationId: z.string(),
      sourceKey: z.string(),
      type: z.literal("load_source"),
    })
    .strict(),
  z
    .object({
      source: SourceApiActionSourceDescriptorSchema,
      type: z.literal("resolve_descriptor"),
    })
    .strict(),
  z
    .object({
      requestDescriptor: SourceApiActionRequestDescriptorSchema,
      source: SourceApiActionSourceDescriptorSchema,
      type: z.literal("prepare_request"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      pageIndex: z.number().int(),
      preparedRequestFingerprint: z.string(),
      requestDescriptor: SourceApiActionRequestDescriptorSchema,
      source: SourceApiActionSourceDescriptorSchema,
      type: z.literal("execute_page"),
    })
    .strict(),
]);
