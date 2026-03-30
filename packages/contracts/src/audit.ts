import { z } from "zod";

export const DEFAULT_AUDIT_LIMIT = 25;
export const MAX_AUDIT_LIMIT = 100;
export const AUDIT_FAMILY = "cli_query_action" as const;

export const CLI_QUERY_ACTION_TYPES = ["validate", "execute"] as const;
export type CliQueryActionType = (typeof CLI_QUERY_ACTION_TYPES)[number];

export const CLI_QUERY_ACTION_STAGES = [
  "received",
  "load_source",
  "validate_query",
  "load_credentials",
  "execute_query",
  "persist_usage",
  "completed",
] as const;
export type CliQueryActionStage = (typeof CLI_QUERY_ACTION_STAGES)[number];

export const CLI_QUERY_ACTION_STATUSES = [
  "pending",
  "succeeded",
  "source_not_found",
  "source_not_queryable",
  "query_rejected",
  "query_preparation_failed",
  "query_unavailable",
  "query_timed_out",
  "query_execution_failed",
] as const;
export type CliQueryActionStatus = (typeof CLI_QUERY_ACTION_STATUSES)[number];

export const CLI_QUERY_USAGE_PERSISTENCE_STATUSES = [
  "not_started",
  "succeeded",
  "failed",
] as const;
export type CliQueryUsagePersistenceStatus =
  (typeof CLI_QUERY_USAGE_PERSISTENCE_STATUSES)[number];

export const CLI_QUERY_ACTION_ACTOR_AUTH_MODES = [
  "browser_session",
  "bearer_token",
] as const;
export type CliQueryActionActorAuthMode =
  (typeof CLI_QUERY_ACTION_ACTOR_AUTH_MODES)[number];

export const CLI_QUERY_ACTION_EVENT_TYPES = [
  "action_received",
  "source_loaded",
  "source_not_found",
  "source_not_queryable",
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
export type CliQueryActionEventType =
  (typeof CLI_QUERY_ACTION_EVENT_TYPES)[number];

const trimmedSearchStringSchema = z.preprocess((value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().min(1).max(200));

const actionTypeSearchSchema = z.preprocess((value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.enum(CLI_QUERY_ACTION_TYPES));

const statusSearchSchema = z.preprocess((value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.enum(CLI_QUERY_ACTION_STATUSES));

const cursorSearchSchema = z.preprocess((value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().min(1).max(256));

export const auditSearchSchema = z.object({
  actionType: actionTypeSearchSchema.optional(),
  cursor: cursorSearchSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_AUDIT_LIMIT)
    .catch(DEFAULT_AUDIT_LIMIT),
  q: trimmedSearchStringSchema.optional(),
  sourceKey: trimmedSearchStringSchema.optional(),
  status: statusSearchSchema.optional(),
});
export type AuditSearch = z.infer<typeof auditSearchSchema>;

export const auditListQuerySchema = z.object({
  actionType: actionTypeSearchSchema.optional(),
  cursor: cursorSearchSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_AUDIT_LIMIT)
    .default(DEFAULT_AUDIT_LIMIT),
  q: trimmedSearchStringSchema.optional(),
  sourceKey: trimmedSearchStringSchema.optional(),
  status: statusSearchSchema.optional(),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const auditListItemSchema = z.object({
  action: z.object({
    provider: z.string().nullable(),
    requestId: z.string(),
    sourceId: z.string().nullable(),
    sourceKey: z.string(),
    type: z.enum(CLI_QUERY_ACTION_TYPES),
  }),
  actor: z.object({
    email: z.string(),
    membershipRoles: z.array(z.string()),
    userId: z.string(),
  }),
  error: z
    .object({
      detail: z.string().nullable(),
      hint: z.string().nullable(),
    })
    .nullable(),
  family: z.literal(AUDIT_FAMILY),
  id: z.string(),
  metrics: z.object({
    elapsedMs: z.number().int().nullable(),
    retryable: z.boolean().nullable(),
    rowCount: z.number().int().nullable(),
  }),
  occurredAt: z.coerce.date(),
  query: z.object({
    normalizedSql: z.string().nullable(),
    normalizedSqlChanged: z.boolean(),
    sql: z.string(),
  }),
  state: z.object({
    lastEventType: z.enum(CLI_QUERY_ACTION_EVENT_TYPES),
    stage: z.enum(CLI_QUERY_ACTION_STAGES),
    status: z.enum(CLI_QUERY_ACTION_STATUSES),
    usagePersistenceStatus: z.enum(CLI_QUERY_USAGE_PERSISTENCE_STATUSES),
  }),
});

export const auditListResponseSchema = z.object({
  families: z.array(z.literal(AUDIT_FAMILY)),
  items: z.array(auditListItemSchema),
  nextCursor: z.string().nullable(),
});

export type AuditListItem = z.infer<typeof auditListItemSchema>;
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;
