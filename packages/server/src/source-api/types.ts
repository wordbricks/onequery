import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import type { Credentials, ProviderType } from "@onequery/db/server";

import type { OrganizationRoleName } from "../auth/organization-permissions";

export type SourceApiOperationKind = "http_request" | "structured_request";

export type SourceApiSelectorKind = "none" | "path" | "identifier";

export type SourceApiPaginationPolicy = "none" | "opaque_token";

export type SourceApiBodyKind = "none" | "json" | "text" | "binary";

export type ConnectedSourceRecord = {
  id: string;
  sourceKey: string;
  provider: ProviderType;
  displayName: string | null;
};

export type PreparedSourceConnection<
  TCredentials extends Credentials = Credentials,
> = ConnectedSourceRecord & {
  credentials: TCredentials;
};

export type SourceApiActorContext = {
  userId: string;
  organizationId: string;
  organizationSlug: string;
  membershipRoles: readonly OrganizationRoleName[];
  capabilities: readonly string[];
  requestId?: string;
};

export type SourceApiSource = {
  key: string;
  provider: ProviderType;
  displayName?: string | null;
};

export type SourceApiHeader = {
  name: string;
  value: string;
};

export type SourceApiExample = {
  label: string;
  command: string;
  description?: string;
};

export type SourceApiMethodPolicy = {
  defaultMethod?: string;
  allowedMethods: readonly string[];
};

export type SourceApiFieldPolicy = {
  allowsRawFields: boolean;
  allowsTypedFields: boolean;
  supportsNestedPaths: boolean;
  supportsArrayPaths: boolean;
  acceptsInput: boolean;
  inputMode: "none" | "request_object" | "request_body";
  mergePatches: boolean;
};

export type SourceApiHeaderPolicy = {
  allowedRequestHeaders: readonly string[];
  allowedResponseHeaders: readonly string[];
};

export type SourceApiPolicyRule = {
  effect: "allow" | "deny";
  provider?: ProviderType;
  operation?: string;
  method?: string;
  host?: string;
  selectorTemplate?: string;
  headerNames?: readonly string[];
  bodyPaths?: readonly string[];
};

export type SourceApiPolicyDecision = {
  allowed: boolean;
  reason?: string;
  rule?: SourceApiPolicyRule;
};

export type SourceApiOperation = {
  name: string;
  kind: SourceApiOperationKind;
  summary: string;
  description: string;
  selectorKind: SourceApiSelectorKind;
  selectorLabel?: string;
  methodPolicy: SourceApiMethodPolicy;
  fieldPolicy: SourceApiFieldPolicy;
  headerPolicy: SourceApiHeaderPolicy;
  paginationPolicy: SourceApiPaginationPolicy;
  examples: readonly SourceApiExample[];
  notes: readonly string[];
};

export type SourceApiDescriptor = {
  source: SourceApiSource;
  descriptorVersion: string;
  defaultPathOperation?: string;
  operations: readonly SourceApiOperation[];
  examples: readonly SourceApiExample[];
  notes: readonly string[];
};

export type SourceApiRequestBody =
  | { kind: "none" }
  | { kind: "json"; value: JsonValue }
  | { kind: "text"; value: string }
  | { kind: "binary"; value: Uint8Array };

export type SourceApiDraft = {
  descriptorVersion?: string;
  operation: string;
  selector?: string;
  methodOverride?: string;
  headers: readonly SourceApiHeader[];
  fieldPatch?: JsonObject;
  body: SourceApiRequestBody;
};

export type SourceApiResponseBody =
  | { kind: "none" }
  | { kind: "json"; value: JsonValue }
  | { kind: "text"; value: string }
  | { kind: "binary"; value: Uint8Array };

export type SourceApiContinuationState = JsonValue;

export type SourceApiExecutionResult = {
  source: SourceApiSource;
  operation: string;
  selector?: string;
  status: number;
  headers: readonly SourceApiHeader[];
  contentType: string;
  body: SourceApiResponseBody;
  nextContinuationState?: SourceApiContinuationState;
};

export type SourceApiExecutionResponse = {
  source: SourceApiSource;
  operation: string;
  selector?: string;
  status: number;
  headers: readonly SourceApiHeader[];
  contentType: string;
  body: SourceApiResponseBody;
  nextPageToken?: string;
};

type SourceApiPreparedBase = {
  sourceId: string;
  sourceKey: string;
  provider: ProviderType;
  operation: string;
  kind: SourceApiOperationKind;
  method?: string;
  selector?: string;
  selectorTemplate?: string;
  host?: string;
  headerNames: readonly string[];
  bodyKind: SourceApiBodyKind;
  bodyPaths: readonly string[];
  preparedBinding: string;
  descriptorVersion?: string;
  headers: readonly SourceApiHeader[];
  body: SourceApiRequestBody;
};

type SourceApiPreparedPaginationBasis = {
  paginationPolicy: SourceApiPaginationPolicy;
};

type SourceApiPreparedInputBase = Omit<
  SourceApiPreparedBase & SourceApiPreparedPaginationBasis,
  "headerNames" | "bodyKind" | "bodyPaths" | "preparedBinding" | "host"
>;

export type PreparedHttpSourceApi = SourceApiPreparedBase &
  SourceApiPreparedPaginationBasis & {
    kind: "http_request";
    method: string;
    url: string;
    timeoutMs?: number;
    query?: JsonObject;
    metadata?: JsonObject;
  };

export type PreparedStructuredSourceApi = SourceApiPreparedBase &
  SourceApiPreparedPaginationBasis & {
    kind: "structured_request";
    method: string;
    request: JsonObject;
    metadata?: JsonObject;
  };

export type PreparedSourceApi =
  | PreparedHttpSourceApi
  | PreparedStructuredSourceApi;

export type PreparedSourceApiWithoutBinding =
  | Omit<PreparedHttpSourceApi, "preparedBinding">
  | Omit<PreparedStructuredSourceApi, "preparedBinding">;

export type UnboundPreparedHttpSourceApi = SourceApiPreparedInputBase & {
  kind: "http_request";
  method: string;
  url: string;
  timeoutMs?: number;
  query?: JsonObject;
  metadata?: JsonObject;
};

export type UnboundPreparedStructuredSourceApi = SourceApiPreparedInputBase & {
  kind: "structured_request";
  method: string;
  request: JsonObject;
  metadata?: JsonObject;
};

export type UnboundPreparedSourceApi =
  | UnboundPreparedHttpSourceApi
  | UnboundPreparedStructuredSourceApi;

export type NormalizedHttpRequestPlan = PreparedHttpSourceApi;

export type NormalizedStructuredRequestPlan = PreparedStructuredSourceApi;

export type NormalizedExecutionPlan = PreparedSourceApi;

export type FinalizedNormalizedExecutionPlan = Omit<
  PreparedSourceApi,
  "preparedBinding"
>;

export type UnfingerprintedNormalizedHttpRequestPlan =
  UnboundPreparedHttpSourceApi & UnboundPreparedPaginationBasis;

export type UnfingerprintedNormalizedStructuredRequestPlan =
  UnboundPreparedStructuredSourceApi & UnboundPreparedPaginationBasis;

export type UnfingerprintedNormalizedExecutionPlan = UnboundPreparedSourceApi &
  UnboundPreparedPaginationBasis;

export type PreparedSourceApiPreview = {
  sourceKey: string;
  provider: ProviderType;
  operation: string;
  selector?: string;
  kind: SourceApiOperationKind;
  method?: string;
  host?: string;
  url?: string;
  headerNames: readonly string[];
  bodyKind: SourceApiBodyKind;
  bodyPaths: readonly string[];
  paginationPolicy: SourceApiPaginationPolicy;
};

export type SourceApiPaginationTokenPayload = {
  sourceKey: string;
  operation: string;
  preparedBinding: string;
  descriptorVersion?: string;
  issuedAt: string;
  expiresAt: string;
  state: JsonValue;
};

type UnboundPreparedPaginationBasis = {
  paginationPolicy: SourceApiPaginationPolicy;
};

export type SourceApiAdapter = {
  provider: ProviderType;
  describe(input: {
    source: PreparedSourceConnection;
    actor: SourceApiActorContext;
  }): Promise<SourceApiDescriptor>;
  normalize(input: {
    source: PreparedSourceConnection;
    actor: SourceApiActorContext;
    descriptor: SourceApiDescriptor;
    request: SourceApiDraft;
  }): Promise<UnboundPreparedSourceApi & UnboundPreparedPaginationBasis>;
  execute(input: {
    source: PreparedSourceConnection;
    actor: SourceApiActorContext;
    prepared: PreparedSourceApi;
    continuation?: SourceApiContinuationState;
  }): Promise<SourceApiExecutionResult>;
};
