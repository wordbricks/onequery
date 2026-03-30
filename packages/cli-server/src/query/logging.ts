import { and, eq, getDatabaseSchema, isNull, ulid } from "@onequery/db/server";
import type {
  CliQueryAction,
  CliQueryActionActorAuthMode,
  CliQueryActionEventType,
  CliQueryActionStage,
  CliQueryActionStatus,
  CliQueryActionType,
  CliQueryUsagePersistenceStatus,
  DataSourceStatus,
  Database,
  ProviderType,
} from "@onequery/db/server";

import type { CliQueryWorkflowEvent } from "./workflow";

type Nullable<T> = T | null;

export type CliQueryActionTrailActor = {
  authMode: CliQueryActionActorAuthMode;
  email: string;
  membershipRoles: string[];
  userId: string;
};

type CliQueryActionFoldUpdate = {
  stage: CliQueryActionStage;
  status: CliQueryActionStatus;
  usagePersistenceStatus?: CliQueryUsagePersistenceStatus;
  sourceId?: string | null;
  provider?: ProviderType | null;
  sourceStatus?: DataSourceStatus | null;
  normalizedSql?: string | null;
  normalizedSqlChanged?: boolean;
  rowCount?: number | null;
  elapsedMs?: number | null;
  errorDetail?: string | null;
  errorHint?: string | null;
  retryable?: boolean | null;
  completedAt?: Date | null;
};

type CliQueryActionSnapshot = Pick<
  CliQueryAction,
  | "actionType"
  | "actorAuthMode"
  | "actorEmail"
  | "actorMembershipRoles"
  | "actorUserId"
  | "cellMaxChars"
  | "completedAt"
  | "elapsedMs"
  | "errorDetail"
  | "errorHint"
  | "id"
  | "lastEventId"
  | "maxBytes"
  | "maxRows"
  | "normalizedSql"
  | "normalizedSqlChanged"
  | "organizationId"
  | "provider"
  | "requestId"
  | "retryable"
  | "rowCount"
  | "sourceId"
  | "sourceKey"
  | "sourceStatus"
  | "sql"
  | "stage"
  | "status"
  | "timeoutMs"
  | "usagePersistenceStatus"
  | "version"
>;

class CliQueryActionConflictError extends Error {
  constructor(actionId: string) {
    super(`cli query action ${actionId} changed while appending an event`);
    this.name = "CliQueryActionConflictError";
  }
}

class CliQueryActionTransitionError extends Error {
  constructor(actionId: string, eventType: CliQueryActionEventType) {
    super(`cli query action ${actionId} cannot accept ${eventType}`);
    this.name = "CliQueryActionTransitionError";
  }
}

export async function createCliQueryActionTrail(input: {
  db: Database;
  organizationId: string;
  actor: CliQueryActionTrailActor;
  requestId: string;
  actionType: CliQueryActionType;
  sourceKey: string;
  sql: string;
  maxRows: number | null;
  maxBytes: number | null;
  cellMaxChars: number | null;
  timeoutMs: number | null;
}): Promise<{ actionId: string; eventId: string }> {
  const { cliQueryActionEvents, cliQueryActions } = getDatabaseSchema(input.db);
  const actionId = ulid();
  const eventId = ulid();
  const occurredAt = new Date();

  await input.db.transaction(async (tx) => {
    await tx.insert(cliQueryActions).values({
      actionType: input.actionType,
      actorAuthMode: input.actor.authMode,
      actorEmail: input.actor.email,
      actorMembershipRoles: input.actor.membershipRoles,
      actorUserId: input.actor.userId,
      cellMaxChars: input.cellMaxChars,
      createdAt: occurredAt,
      id: actionId,
      lastEventAt: occurredAt,
      maxBytes: input.maxBytes,
      maxRows: input.maxRows,
      organizationId: input.organizationId,
      requestId: input.requestId,
      sourceKey: input.sourceKey,
      sql: input.sql,
      stage: "received",
      status: "pending",
      timeoutMs: input.timeoutMs,
      updatedAt: occurredAt,
      usagePersistenceStatus: "not_started",
      version: 1,
    });

    await tx.insert(cliQueryActionEvents).values({
      actionType: input.actionType,
      actorAuthMode: input.actor.authMode,
      actorEmail: input.actor.email,
      actorMembershipRoles: input.actor.membershipRoles,
      actorUserId: input.actor.userId,
      cellMaxChars: input.cellMaxChars,
      eventType: "action_received",
      id: eventId,
      maxBytes: input.maxBytes,
      maxRows: input.maxRows,
      occurredAt,
      organizationId: input.organizationId,
      queryActionId: actionId,
      requestId: input.requestId,
      sourceKey: input.sourceKey,
      sql: input.sql,
      stage: "received",
      status: "pending",
      timeoutMs: input.timeoutMs,
      usagePersistenceStatus: "not_started",
    });

    await tx
      .update(cliQueryActions)
      .set({
        lastEventAt: occurredAt,
        lastEventId: eventId,
        updatedAt: occurredAt,
      })
      .where(eq(cliQueryActions.id, actionId));
  });

  return { actionId, eventId };
}

export async function appendCliQueryActionTrailEvent(input: {
  db: Database;
  actionId: string;
  event: CliQueryWorkflowEvent;
}): Promise<{ eventId: string }> {
  switch (input.event.type) {
    case "source_loaded": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "source_loaded",
        update: {
          provider: input.event.source.provider,
          sourceId: input.event.source.id,
          sourceStatus: input.event.source.status,
          stage: "validate_query",
          status: "pending",
        },
      });
    }
    case "source_not_found": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "source_not_found",
        orgSlug: input.event.orgSlug,
        update: {
          completedAt: new Date(),
          stage: "completed",
          status: "source_not_found",
        },
      });
    }
    case "source_not_queryable": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "source_not_queryable",
        update: {
          completedAt: new Date(),
          provider: input.event.provider,
          sourceStatus: input.event.sourceStatus,
          stage: "completed",
          status: "source_not_queryable",
        },
      });
    }
    case "query_validated": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "query_validated",
        update: {
          completedAt:
            input.event.actionType === "validate" ? new Date() : undefined,
          normalizedSql: input.event.normalizedSql,
          normalizedSqlChanged: input.event.normalizedSqlChanged,
          provider: input.event.source.provider,
          sourceId: input.event.source.id,
          sourceStatus: input.event.source.status,
          stage:
            input.event.actionType === "validate"
              ? "completed"
              : "load_credentials",
          status:
            input.event.actionType === "validate" ? "succeeded" : "pending",
        },
      });
    }
    case "query_rejected": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "query_rejected",
        update: {
          completedAt: new Date(),
          errorDetail: input.event.detail,
          provider: input.event.source.provider,
          sourceId: input.event.source.id,
          sourceStatus: input.event.source.status,
          stage: "completed",
          status: "query_rejected",
        },
      });
    }
    case "credentials_loaded": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "credentials_loaded",
        update: {
          provider: input.event.source.provider,
          sourceId: input.event.source.id,
          sourceStatus: input.event.source.status,
          stage: "execute_query",
          status: "pending",
        },
      });
    }
    case "query_preparation_failed": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "query_preparation_failed",
        update: {
          completedAt: new Date(),
          errorDetail: input.event.detail,
          errorHint: input.event.hint ?? null,
          provider: input.event.source?.provider,
          sourceId: input.event.source?.id,
          sourceStatus: input.event.source?.status,
          stage: "completed",
          status: "query_preparation_failed",
        },
      });
    }
    case "query_executed": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "query_executed",
        update: {
          elapsedMs: input.event.elapsedMs,
          provider: input.event.source.provider,
          rowCount: input.event.rowCount,
          sourceId: input.event.source.id,
          sourceStatus: input.event.source.status,
          stage: "persist_usage",
          status: "pending",
        },
      });
    }
    case "query_unavailable": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "query_unavailable",
        update: {
          completedAt: new Date(),
          errorDetail: input.event.detail,
          provider: input.event.source.provider,
          retryable: true,
          sourceId: input.event.source.id,
          sourceStatus: input.event.source.status,
          stage: "completed",
          status: "query_unavailable",
        },
      });
    }
    case "query_timed_out": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "query_timed_out",
        update: {
          completedAt: new Date(),
          errorDetail: input.event.detail,
          provider: input.event.source.provider,
          retryable: true,
          sourceId: input.event.source.id,
          sourceStatus: input.event.source.status,
          stage: "completed",
          status: "query_timed_out",
        },
      });
    }
    case "query_execution_failed": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "query_execution_failed",
        update: {
          completedAt: new Date(),
          errorDetail: input.event.detail,
          provider: input.event.source.provider,
          retryable: false,
          sourceId: input.event.source.id,
          sourceStatus: input.event.source.status,
          stage: "completed",
          status: "query_execution_failed",
        },
      });
    }
    case "usage_persisted": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "usage_persisted",
        update: {
          completedAt: new Date(),
          stage: "completed",
          status: "succeeded",
          usagePersistenceStatus: "succeeded",
        },
      });
    }
    case "usage_persist_failed": {
      return appendCliQueryActionEvent({
        actionId: input.actionId,
        db: input.db,
        eventType: "usage_persist_failed",
        update: {
          completedAt: new Date(),
          errorDetail: input.event.detail,
          stage: "completed",
          status: "succeeded",
          usagePersistenceStatus: "failed",
        },
      });
    }
  }
}

async function appendCliQueryActionEvent(input: {
  db: Database;
  actionId: string;
  eventType: CliQueryActionEventType;
  update: CliQueryActionFoldUpdate;
  orgSlug?: string | null;
}): Promise<{ eventId: string }> {
  const { cliQueryActionEvents, cliQueryActions } = getDatabaseSchema(input.db);
  const eventId = ulid();
  const occurredAt = new Date();

  return input.db.transaction(async (tx) => {
    const [rawAction] = await tx
      .select()
      .from(cliQueryActions)
      .where(eq(cliQueryActions.id, input.actionId))
      .limit(1);
    const action = rawAction as CliQueryActionSnapshot | undefined;

    if (!action) {
      throw new Error(`cli query action ${input.actionId} not found`);
    }

    const [existingEvent] = await tx
      .select({
        id: cliQueryActionEvents.id,
      })
      .from(cliQueryActionEvents)
      .where(
        and(
          eq(cliQueryActionEvents.queryActionId, action.id),
          eq(cliQueryActionEvents.eventType, input.eventType)
        )
      )
      .limit(1);

    if (existingEvent) {
      return {
        eventId: existingEvent.id,
      };
    }

    assertCliQueryActionTransitionAllowed(action, input.eventType);
    const next = mergeCliQueryActionSnapshot(action, input.update);

    try {
      // Keep raw SQL on the aggregate and immutable received event only.
      await tx.insert(cliQueryActionEvents).values([
        {
          actionType: action.actionType,
          actorAuthMode: action.actorAuthMode,
          actorEmail: action.actorEmail,
          actorMembershipRoles: action.actorMembershipRoles,
          actorUserId: action.actorUserId,
          causationEventId: action.lastEventId,
          cellMaxChars: action.cellMaxChars,
          elapsedMs: next.elapsedMs,
          errorDetail: next.errorDetail,
          errorHint: next.errorHint,
          eventType: input.eventType,
          id: eventId,
          maxBytes: action.maxBytes,
          maxRows: action.maxRows,
          normalizedSql: next.normalizedSql,
          normalizedSqlChanged: next.normalizedSqlChanged,
          occurredAt,
          organizationId: action.organizationId,
          orgSlug: input.orgSlug ?? null,
          provider: next.provider,
          queryActionId: action.id,
          requestId: action.requestId,
          retryable: next.retryable,
          rowCount: next.rowCount,
          sourceId: next.sourceId,
          sourceKey: action.sourceKey,
          sourceStatus: next.sourceStatus,
          sql: null,
          stage: next.stage,
          status: next.status,
          timeoutMs: action.timeoutMs,
          usagePersistenceStatus: next.usagePersistenceStatus,
        },
      ]);
    } catch (error) {
      if (!isCliQueryActionEventDuplicateError(error)) {
        throw error;
      }

      const [existingEvent] = await tx
        .select({
          id: cliQueryActionEvents.id,
        })
        .from(cliQueryActionEvents)
        .where(
          and(
            eq(cliQueryActionEvents.queryActionId, action.id),
            eq(cliQueryActionEvents.eventType, input.eventType)
          )
        )
        .limit(1);

      if (!existingEvent) {
        throw error;
      }

      return {
        eventId: existingEvent.id,
      };
    }

    const updatedActions = await tx
      .update(cliQueryActions)
      .set({
        completedAt: next.completedAt,
        elapsedMs: next.elapsedMs,
        errorDetail: next.errorDetail,
        errorHint: next.errorHint,
        lastEventAt: occurredAt,
        lastEventId: eventId,
        normalizedSql: next.normalizedSql,
        normalizedSqlChanged: next.normalizedSqlChanged,
        provider: next.provider,
        retryable: next.retryable,
        rowCount: next.rowCount,
        sourceId: next.sourceId,
        sourceStatus: next.sourceStatus,
        stage: next.stage,
        status: next.status,
        updatedAt: occurredAt,
        usagePersistenceStatus: next.usagePersistenceStatus,
        version: action.version + 1,
      })
      .where(buildCliQueryActionUpdateWhere(cliQueryActions, action))
      .returning({
        id: cliQueryActions.id,
      });

    if (updatedActions.length !== 1) {
      throw new CliQueryActionConflictError(action.id);
    }

    return { eventId };
  });
}

function assertCliQueryActionTransitionAllowed(
  action: CliQueryActionSnapshot,
  eventType: CliQueryActionEventType
): void {
  if (action.stage === "completed") {
    throw new CliQueryActionTransitionError(action.id, eventType);
  }

  if (eventType === "query_preparation_failed") {
    return;
  }

  let allowedEventTypes: readonly CliQueryActionEventType[] = [];

  switch (action.stage) {
    case "received": {
      allowedEventTypes = [
        "source_loaded",
        "source_not_found",
        "source_not_queryable",
      ];
      break;
    }
    case "validate_query": {
      allowedEventTypes = ["query_validated", "query_rejected"];
      break;
    }
    case "load_credentials": {
      allowedEventTypes =
        action.actionType === "execute" ? ["credentials_loaded"] : [];
      break;
    }
    case "execute_query": {
      allowedEventTypes =
        action.actionType === "execute"
          ? [
              "query_executed",
              "query_unavailable",
              "query_timed_out",
              "query_execution_failed",
            ]
          : [];
      break;
    }
    case "persist_usage": {
      allowedEventTypes =
        action.actionType === "execute"
          ? ["usage_persisted", "usage_persist_failed"]
          : [];
      break;
    }
  }

  if (!allowedEventTypes.includes(eventType)) {
    throw new CliQueryActionTransitionError(action.id, eventType);
  }
}

function buildCliQueryActionUpdateWhere(
  cliQueryActions: ReturnType<typeof getDatabaseSchema>["cliQueryActions"],
  action: Pick<CliQueryActionSnapshot, "id" | "lastEventId" | "version">
) {
  return and(
    eq(cliQueryActions.id, action.id),
    eq(cliQueryActions.version, action.version),
    action.lastEventId === null
      ? isNull(cliQueryActions.lastEventId)
      : eq(cliQueryActions.lastEventId, action.lastEventId)
  );
}

function isCliQueryActionEventDuplicateError(error: unknown): boolean {
  const code = getStringProperty(error, "code");

  if (code === "23505") {
    return true;
  }

  const message = getStringProperty(error, "message")?.toLowerCase() ?? "";
  return message.includes("unique constraint failed");
}

function getStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return null;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : null;
}

function mergeCliQueryActionSnapshot(
  action: CliQueryActionSnapshot,
  update: CliQueryActionFoldUpdate
) {
  return {
    completedAt: mergeNullableValue(action.completedAt, update.completedAt),
    elapsedMs: mergeNullableValue(action.elapsedMs, update.elapsedMs),
    errorDetail: mergeNullableValue(action.errorDetail, update.errorDetail),
    errorHint: mergeNullableValue(action.errorHint, update.errorHint),
    normalizedSql: mergeNullableValue(
      action.normalizedSql,
      update.normalizedSql
    ),
    normalizedSqlChanged:
      update.normalizedSqlChanged ?? action.normalizedSqlChanged,
    provider: mergeNullableValue(action.provider, update.provider),
    retryable: mergeNullableValue(action.retryable, update.retryable),
    rowCount: mergeNullableValue(action.rowCount, update.rowCount),
    sourceId: mergeNullableValue(action.sourceId, update.sourceId),
    sourceStatus: mergeNullableValue(action.sourceStatus, update.sourceStatus),
    stage: update.stage,
    status: update.status,
    usagePersistenceStatus:
      update.usagePersistenceStatus ?? action.usagePersistenceStatus,
  };
}

function mergeNullableValue<T>(
  current: Nullable<T>,
  next: Nullable<T> | undefined
): Nullable<T> {
  return next === undefined ? current : next;
}
