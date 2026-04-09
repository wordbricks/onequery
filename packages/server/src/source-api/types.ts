import type {
  Credentials,
  DataSourceStatus,
  ProviderType,
} from "@onequery/db/server";

import type { OrganizationRoleName } from "../auth/organization-permissions";

export type SourceApiOperationKind = "http_request" | "structured_request";

export type SourceApiSelectorKind = "none" | "path" | "identifier";

export type SourceApiPaginationPolicy = "none" | "opaque_token";

export type SourceApiBodyKind = "none" | "json" | "text" | "binary";

export type SourceApiJsonValue =
  | null
  | boolean
  | number
  | string
  | SourceApiJsonValue[]
  | { [key: string]: SourceApiJsonValue };

export type ConnectedSourceRecord = {
  id: string;
  sourceKey: string;
  name: string;
  organizationId: string;
  provider: ProviderType;
  status: DataSourceStatus;
  credentialsEncrypted: string;
  credentialsIv: string;
  useAsDataSource: boolean;
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
  | { kind: "json"; value: SourceApiJsonValue }
  | { kind: "text"; value: string }
  | { kind: "binary"; value: Uint8Array };

export type SourceApiExecuteRequest = {
  descriptorVersion?: string;
  operation: string;
  selector?: string;
  methodOverride?: string;
  headers: readonly SourceApiHeader[];
  fieldPatch?: Record<string, unknown>;
  body: SourceApiRequestBody;
  pageToken?: string;
};

export type SourceApiResponseBody =
  | { kind: "none" }
  | { kind: "json"; value: SourceApiJsonValue }
  | { kind: "text"; value: string }
  | { kind: "binary"; value: Uint8Array };

export type SourceApiExecutionResponse = {
  source: SourceApiSource;
  operation: string;
  selector?: string;
  status: number;
  headers: readonly SourceApiHeader[];
  contentType: string;
  body: SourceApiResponseBody;
  requestId?: string;
  nextPageToken?: string;
};

type NormalizedExecutionPlanBase = {
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
  bodyPaths?: readonly string[];
  requestFingerprint: string;
  descriptorVersion?: string;
  headers: readonly SourceApiHeader[];
  body: SourceApiRequestBody;
};

export type NormalizedHttpRequestPlan = NormalizedExecutionPlanBase & {
  kind: "http_request";
  method: string;
  url: string;
  timeoutMs?: number;
  query?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type NormalizedStructuredRequestPlan = NormalizedExecutionPlanBase & {
  kind: "structured_request";
  request: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type NormalizedExecutionPlan =
  | NormalizedHttpRequestPlan
  | NormalizedStructuredRequestPlan;

export type UnfingerprintedNormalizedExecutionPlan =
  | Omit<NormalizedHttpRequestPlan, "requestFingerprint">
  | Omit<NormalizedStructuredRequestPlan, "requestFingerprint">;

export type SourceApiPaginationTokenPayload = {
  sourceKey: string;
  operation: string;
  requestFingerprint: string;
  descriptorVersion?: string;
  issuedAt: string;
  expiresAt: string;
  state: SourceApiJsonValue;
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
    request: SourceApiExecuteRequest;
  }): Promise<NormalizedExecutionPlan>;
  execute(input: {
    source: PreparedSourceConnection;
    actor: SourceApiActorContext;
    plan: NormalizedExecutionPlan;
  }): Promise<SourceApiExecutionResponse>;
};
