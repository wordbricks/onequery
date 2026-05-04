import type { JsonValue } from "@bufbuild/protobuf";
import type { ProviderType } from "@onequery/db/server";
import type {
  SourceApiHeader,
  SourceApiOperationKind,
  SourceApiPaginationPolicy,
  SourceApiSource,
} from "@onequery/server/source-api";

export const SOURCE_API_ACTION_REQUEST_KINDS = ["describe", "invoke"] as const;
export type SourceApiActionRequestKind =
  (typeof SOURCE_API_ACTION_REQUEST_KINDS)[number];

export const SOURCE_API_ACTION_INVOKE_MODES = [
  "preview_only",
  "execute",
] as const;
export type SourceApiActionInvokeMode =
  (typeof SOURCE_API_ACTION_INVOKE_MODES)[number];

export type SourceApiActionSourceDescriptor = {
  displayName: string | null;
  provider: ProviderType;
  sourceId: string;
  sourceKey: string;
};

export type SourceApiActionRequestDescriptor = {
  descriptorVersion: string | null;
  kind: SourceApiOperationKind | null;
  method: string | null;
  operation: string;
  paginationPolicy: SourceApiPaginationPolicy | null;
  selector: string | null;
};

export type SourceApiActionPageProgress = {
  nextPageIndex: number;
};

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
