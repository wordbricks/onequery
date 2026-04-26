import type { JsonValue } from "@bufbuild/protobuf";
import { PROVIDER_TYPES } from "@onequery/db/server";
import type { ProviderType } from "@onequery/db/server";
import type {
  SourceApiHeader,
  SourceApiOperationKind,
  SourceApiPaginationPolicy,
  SourceApiSource,
} from "@onequery/server/source-api";
import { z } from "zod";

export const SOURCE_API_ACTION_REQUEST_KINDS = ["describe", "invoke"] as const;
export type SourceApiActionRequestKind =
  (typeof SOURCE_API_ACTION_REQUEST_KINDS)[number];

export const SOURCE_API_ACTION_INVOKE_MODES = [
  "preview_only",
  "execute",
] as const;
export type SourceApiActionInvokeMode =
  (typeof SOURCE_API_ACTION_INVOKE_MODES)[number];

export const SOURCE_API_OPERATION_KINDS = [
  "http_request",
  "structured_request",
] as const satisfies readonly SourceApiOperationKind[];

export const SOURCE_API_PAGINATION_POLICIES = [
  "none",
  "continuation_token",
] as const satisfies readonly SourceApiPaginationPolicy[];

export type SourceApiActionSourceDescriptor = {
  displayName: string | null;
  provider: ProviderType;
  sourceId: string;
  sourceKey: string;
};

export const SourceApiActionSourceDescriptorSchema = z
  .object({
    displayName: z.string().nullable(),
    provider: z.enum(PROVIDER_TYPES),
    sourceId: z.string(),
    sourceKey: z.string(),
  })
  .strict();

export type SourceApiActionRequestDescriptor = {
  descriptorVersion: string | null;
  kind: SourceApiOperationKind | null;
  method: string | null;
  operation: string;
  paginationPolicy: SourceApiPaginationPolicy | null;
  selector: string | null;
};

export const SourceApiActionRequestDescriptorSchema = z
  .object({
    descriptorVersion: z.string().nullable(),
    kind: z.enum(SOURCE_API_OPERATION_KINDS).nullable(),
    method: z.string().nullable(),
    operation: z.string(),
    paginationPolicy: z.enum(SOURCE_API_PAGINATION_POLICIES).nullable(),
    selector: z.string().nullable(),
  })
  .strict();

export type SourceApiActionPageProgress = {
  nextPageIndex: number;
};

export const SourceApiActionPageProgressSchema = z
  .object({
    nextPageIndex: z.number().int(),
  })
  .strict();

export type StoredSourceApiResponseBody =
  | {
      kind: "none";
    }
  | {
      kind: "json";
      value: JsonValue;
    }
  | {
      kind: "text";
      value: string;
    }
  | {
      kind: "binary";
      value: Uint8Array;
    };

export type StoredSourceApiExecutionResult = {
  body: StoredSourceApiResponseBody;
  contentType: string;
  headers: readonly SourceApiHeader[];
  nextContinuationState?: JsonValue;
  operation: string;
  selector?: string;
  source: SourceApiSource;
  status: number;
};
