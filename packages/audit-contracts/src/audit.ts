import { z } from "zod";

export const DEFAULT_AUDIT_LIMIT = 25;
export const MAX_AUDIT_LIMIT = 100;

export const AUDIT_FAMILIES = ["query_action", "source_api_action"] as const;
export type AuditFamily = (typeof AUDIT_FAMILIES)[number];

export const AUDIT_ACTION_NAMES = [
  "validate",
  "execute",
  "describe",
  "invoke",
] as const;
export type AuditActionName = (typeof AUDIT_ACTION_NAMES)[number];

export const AUDIT_ACTION_NAMES_BY_FAMILY = {
  query_action: ["validate", "execute"],
  source_api_action: ["describe", "invoke"],
} as const satisfies Record<AuditFamily, readonly AuditActionName[]>;

export const AUDIT_OUTCOMES = ["pending", "succeeded", "failed"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

type AuditSearchFilters = {
  actionName?: AuditActionName;
  family?: AuditFamily;
};

export function getAuditActionNamesForFamily(family?: AuditFamily) {
  return family ? AUDIT_ACTION_NAMES_BY_FAMILY[family] : AUDIT_ACTION_NAMES;
}

export function isAuditActionNameCompatibleWithFamily(
  family: AuditFamily | undefined,
  actionName: AuditActionName | undefined
) {
  if (!family || !actionName) {
    return true;
  }

  return (
    AUDIT_ACTION_NAMES_BY_FAMILY[family] as readonly AuditActionName[]
  ).includes(actionName);
}

export function sanitizeAuditSearch<T extends AuditSearchFilters>(
  search: T
): T {
  if (isAuditActionNameCompatibleWithFamily(search.family, search.actionName)) {
    return search;
  }

  return { ...search, actionName: undefined } as T;
}

export const AUDIT_QUERY_ACTION_PHASES = [
  "load_source",
  "validate_query",
  "load_credentials",
  "execute_query",
  "persist_usage",
  "completed",
] as const;
export type AuditQueryActionPhase = (typeof AUDIT_QUERY_ACTION_PHASES)[number];

export const AUDIT_QUERY_ACTION_FAILURE_CODES = [
  "source_not_found",
  "source_query_interface_missing",
  "query_rejected",
  "query_preparation_failed",
  "query_unavailable",
  "query_timed_out",
  "query_execution_failed",
] as const;
export type AuditQueryActionFailureCode =
  (typeof AUDIT_QUERY_ACTION_FAILURE_CODES)[number];

export const AUDIT_QUERY_ACTION_EVENT_TYPES = [
  "action_received",
  "source_loaded",
  "source_not_found",
  "source_query_interface_missing",
  "query_validated",
  "query_rejected",
  "credentials_loaded",
  "query_preparation_failed",
  "query_executed",
  "query_unavailable",
  "query_timed_out",
  "query_execution_failed",
  "usage_persisted",
  "usage_persist_failed",
] as const;
export type AuditQueryActionEventType =
  (typeof AUDIT_QUERY_ACTION_EVENT_TYPES)[number];

export const AUDIT_QUERY_ACTION_USAGE_RECORDING_STATUSES = [
  "not_started",
  "succeeded",
  "failed",
] as const;
export type AuditQueryActionUsageRecordingStatus =
  (typeof AUDIT_QUERY_ACTION_USAGE_RECORDING_STATUSES)[number];

export const AUDIT_SOURCE_API_ACTION_PHASES = [
  "load_source",
  "describe_source",
  "prepare_request",
  "execute_request",
  "await_resume",
  "completed",
] as const;
export type AuditSourceApiActionPhase =
  (typeof AUDIT_SOURCE_API_ACTION_PHASES)[number];

export const AUDIT_SOURCE_API_ACTION_FAILURE_CODES = [
  "source_not_found",
  "descriptor_unavailable",
  "invalid_request",
  "permission_denied",
  "request_failed",
  "request_timed_out",
  "execution_failed",
  "execution_state_invalid",
] as const;
export type AuditSourceApiActionFailureCode =
  (typeof AUDIT_SOURCE_API_ACTION_FAILURE_CODES)[number];

export const AUDIT_SOURCE_API_ACTION_EVENT_TYPES = [
  "action_received",
  "source_loaded",
  "source_not_found",
  "descriptor_resolved",
  "descriptor_resolution_failed",
  "request_prepared",
  "request_preparation_failed",
  "resume_requested",
  "page_fetch_succeeded",
  "page_fetch_failed",
] as const;
export type AuditSourceApiActionEventType =
  (typeof AUDIT_SOURCE_API_ACTION_EVENT_TYPES)[number];

export const AUDIT_SOURCE_API_ACTION_INVOKE_MODES = [
  "preview_only",
  "execute",
] as const;
export type AuditSourceApiActionInvokeMode =
  (typeof AUDIT_SOURCE_API_ACTION_INVOKE_MODES)[number];

const trimmedSearchStringSchema = z.preprocess((value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().min(1).max(200));

const cursorSearchSchema = z.preprocess((value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().min(1).max(256));

const familySearchSchema = z.preprocess((value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.enum(AUDIT_FAMILIES));

const actionNameSearchSchema = z.preprocess((value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.enum(AUDIT_ACTION_NAMES));

const outcomeSearchSchema = z.preprocess((value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.enum(AUDIT_OUTCOMES));

const auditSearchShape = {
  actionName: actionNameSearchSchema.optional(),
  cursor: cursorSearchSchema.optional(),
  family: familySearchSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_AUDIT_LIMIT)
    .catch(DEFAULT_AUDIT_LIMIT),
  outcome: outcomeSearchSchema.optional(),
  q: trimmedSearchStringSchema.optional(),
  sourceKey: trimmedSearchStringSchema.optional(),
} satisfies z.ZodRawShape;

export const auditSearchSchema = z
  .object(auditSearchShape)
  .transform(sanitizeAuditSearch);
export type AuditSearch = z.infer<typeof auditSearchSchema>;

const auditListQueryShape = {
  actionName: actionNameSearchSchema.optional(),
  cursor: cursorSearchSchema.optional(),
  family: familySearchSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_AUDIT_LIMIT)
    .default(DEFAULT_AUDIT_LIMIT),
  outcome: outcomeSearchSchema.optional(),
  q: trimmedSearchStringSchema.optional(),
  sourceKey: trimmedSearchStringSchema.optional(),
} satisfies z.ZodRawShape;

export const auditListQuerySchema = z
  .object(auditListQueryShape)
  .transform(sanitizeAuditSearch);
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const auditOriginActorSchema = z
  .object({
    authMode: z.string().nullable(),
    email: z.string().nullable(),
    membershipRoles: z.array(z.string()),
    userId: z.string().nullable(),
  })
  .strict();
export type AuditOriginActor = z.infer<typeof auditOriginActorSchema>;

export const auditTargetSchema = z
  .object({
    displayName: z.string().nullable(),
    provider: z.string().nullable(),
    sourceId: z.string().nullable(),
    sourceKey: z.string(),
    sourceName: z.string().nullable(),
  })
  .strict();
export type AuditTarget = z.infer<typeof auditTargetSchema>;

export const auditQueryActionMetricsSchema = z
  .object({
    elapsedMs: z.number().int().nullable(),
    rowCount: z.number().int().nullable(),
  })
  .strict();
export type AuditQueryActionMetrics = z.infer<
  typeof auditQueryActionMetricsSchema
>;

export const auditQueryActionPreviewSchema = z
  .object({
    elapsedMs: z.number().int().nullable(),
    queryText: z.string(),
    rowCount: z.number().int().nullable(),
    usageRecordingStatus: z.enum(AUDIT_QUERY_ACTION_USAGE_RECORDING_STATUSES),
    validatedQuery: z.string().nullable(),
  })
  .strict();
export type AuditQueryActionPreview = z.infer<
  typeof auditQueryActionPreviewSchema
>;

export const auditSourceApiActionMetricsSchema = z
  .object({
    httpStatus: z.number().int().nullable(),
    pageCount: z.number().int().nullable(),
    responseBytes: z.number().int().nullable(),
  })
  .strict();
export type AuditSourceApiActionMetrics = z.infer<
  typeof auditSourceApiActionMetricsSchema
>;

export const auditSourceApiActionPreviewSchema = z
  .object({
    attemptNumber: z.number().int().nullable(),
    httpStatus: z.number().int().nullable(),
    invokeMode: z.enum(AUDIT_SOURCE_API_ACTION_INVOKE_MODES).nullable(),
    method: z.string().nullable(),
    operation: z.string().nullable(),
    pageCount: z.number().int().nullable(),
    selector: z.string().nullable(),
  })
  .strict();
export type AuditSourceApiActionPreview = z.infer<
  typeof auditSourceApiActionPreviewSchema
>;

const auditBaseListItemSchema = z
  .object({
    actionName: z.enum(AUDIT_ACTION_NAMES),
    completedAt: z.iso.datetime().nullable(),
    familyActionId: z.string(),
    id: z.string(),
    originActor: auditOriginActorSchema,
    originSurface: z.string(),
    outcome: z.enum(AUDIT_OUTCOMES),
    startedAt: z.iso.datetime(),
    subtitle: z.string(),
    target: auditTargetSchema,
    title: z.string(),
    // Comment: Audit timestamps stay ISO strings on the wire so TanStack Query
    // persistence and structural sharing keep operating on JSON-compatible data.
    lastEventAt: z.iso.datetime(),
  })
  .strict();

export const auditQueryActionListItemSchema = auditBaseListItemSchema
  .extend({
    actionName: z.enum(["validate", "execute"]),
    failureCode: z.enum(AUDIT_QUERY_ACTION_FAILURE_CODES).nullable(),
    family: z.literal("query_action"),
    lastEventType: z.enum(AUDIT_QUERY_ACTION_EVENT_TYPES),
    metrics: auditQueryActionMetricsSchema.nullable(),
    phase: z.enum(AUDIT_QUERY_ACTION_PHASES),
    preview: auditQueryActionPreviewSchema.nullable(),
  })
  .strict();
export type AuditQueryActionListItem = z.infer<
  typeof auditQueryActionListItemSchema
>;

export const auditSourceApiActionListItemSchema = auditBaseListItemSchema
  .extend({
    actionName: z.enum(["describe", "invoke"]),
    failureCode: z.enum(AUDIT_SOURCE_API_ACTION_FAILURE_CODES).nullable(),
    family: z.literal("source_api_action"),
    lastEventType: z.enum(AUDIT_SOURCE_API_ACTION_EVENT_TYPES),
    metrics: auditSourceApiActionMetricsSchema.nullable(),
    phase: z.enum(AUDIT_SOURCE_API_ACTION_PHASES),
    preview: auditSourceApiActionPreviewSchema.nullable(),
  })
  .strict();
export type AuditSourceApiActionListItem = z.infer<
  typeof auditSourceApiActionListItemSchema
>;

export const auditListItemSchema = z.discriminatedUnion("family", [
  auditQueryActionListItemSchema,
  auditSourceApiActionListItemSchema,
]);

export const auditProjectedThroughSchema = z
  .object({
    queryAction: z.string().nullable(),
    sourceApiAction: z.string().nullable(),
  })
  .strict();
export type AuditProjectedThrough = z.infer<typeof auditProjectedThroughSchema>;

export const auditProjectionLagSchema = z
  .object({
    queryAction: z.boolean(),
    sourceApiAction: z.boolean(),
  })
  .strict();
export type AuditProjectionLag = z.infer<typeof auditProjectionLagSchema>;

export const auditListResponseSchema = z
  .object({
    families: z.array(z.enum(AUDIT_FAMILIES)),
    items: z.array(auditListItemSchema),
    nextCursor: z.string().nullable(),
    projectionLag: auditProjectionLagSchema,
    projectedThrough: auditProjectedThroughSchema,
  })
  .strict();

export type AuditListItem = z.infer<typeof auditListItemSchema>;
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

const auditPayloadBytesSchema = z
  .object({
    base64: z.string(),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();
export type AuditPayloadBytes = z.infer<typeof auditPayloadBytesSchema>;

export const auditWorkflowCommandTraceSchema = z
  .object({
    actor: auditOriginActorSchema,
    causedByEventId: z.string().nullable(),
    commandInvocationId: z.string(),
    commandPayload: auditPayloadBytesSchema,
    commandType: z.string(),
    createdAt: z.iso.datetime(),
    decodedPayload: z.unknown().nullable(),
    decisionKind: z.string(),
    id: z.string(),
    rejectCode: z.string().nullable(),
    rejectDetail: z.string().nullable(),
    requestId: z.string(),
    surface: z.string(),
  })
  .strict();
export type AuditWorkflowCommandTrace = z.infer<
  typeof auditWorkflowCommandTraceSchema
>;

export const auditWorkflowEventTraceSchema = z
  .object({
    commandId: z.string(),
    commitPosition: z.string(),
    eventType: z.string(),
    id: z.string(),
    occurredAt: z.iso.datetime(),
    payload: auditPayloadBytesSchema,
    decodedPayload: z.unknown().nullable(),
    sequence: z.number().int().positive(),
  })
  .strict();
export type AuditWorkflowEventTrace = z.infer<
  typeof auditWorkflowEventTraceSchema
>;

const auditDetailBaseSchema = z
  .object({
    commands: z.array(auditWorkflowCommandTraceSchema),
    events: z.array(auditWorkflowEventTraceSchema),
    feedEntry: auditListItemSchema,
  })
  .strict();

export const auditQueryActionDetailSchema = auditDetailBaseSchema
  .extend({
    action: z
      .object({
        completedAt: z.iso.datetime().nullable(),
        failureCode: z.enum(AUDIT_QUERY_ACTION_FAILURE_CODES).nullable(),
        id: z.string(),
        lastEventId: z.string(),
        lastEventSequence: z.number().int().positive(),
        outcome: z.enum(AUDIT_OUTCOMES),
        phase: z.enum(AUDIT_QUERY_ACTION_PHASES),
        queryMode: z.string(),
        queryText: z.string(),
        sourceDescriptor: z.unknown().nullable(),
        startedAt: z.iso.datetime(),
        usageRecordingStatus: z.enum(
          AUDIT_QUERY_ACTION_USAGE_RECORDING_STATUSES
        ),
        validatedQuery: z.string().nullable(),
      })
      .strict(),
    family: z.literal("query_action"),
  })
  .strict();
export type AuditQueryActionDetail = z.infer<
  typeof auditQueryActionDetailSchema
>;

export const auditSourceApiActionDetailSchema = auditDetailBaseSchema
  .extend({
    action: z
      .object({
        attemptNumber: z.number().int().nullable(),
        completedAt: z.iso.datetime().nullable(),
        failureCode: z.enum(AUDIT_SOURCE_API_ACTION_FAILURE_CODES).nullable(),
        id: z.string(),
        invokeMode: z.enum(AUDIT_SOURCE_API_ACTION_INVOKE_MODES).nullable(),
        lastEventId: z.string(),
        lastEventSequence: z.number().int().positive(),
        outcome: z.enum(AUDIT_OUTCOMES),
        pageProgress: z.unknown().nullable(),
        phase: z.enum(AUDIT_SOURCE_API_ACTION_PHASES),
        preparedRequestFingerprint: z.string().nullable(),
        requestDescriptor: z.unknown().nullable(),
        requestKind: z.string(),
        sourceDescriptor: z.unknown().nullable(),
        startedAt: z.iso.datetime(),
      })
      .strict(),
    family: z.literal("source_api_action"),
  })
  .strict();
export type AuditSourceApiActionDetail = z.infer<
  typeof auditSourceApiActionDetailSchema
>;

export const auditActionDetailSchema = z.discriminatedUnion("family", [
  auditQueryActionDetailSchema,
  auditSourceApiActionDetailSchema,
]);
export type AuditActionDetail = z.infer<typeof auditActionDetailSchema>;
