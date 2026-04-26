import {
  and,
  asc,
  desc,
  eq,
  queryActionEvents,
  queryActions,
  sourceApiActionEvents,
  sourceApiActions,
  workflowCommands,
} from "@onequery/db/server";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import type { WorkflowCommittedEvent } from "../kernel";
import {
  QueryActionStateSchema,
  decideQueryAction,
  reduceQueryAction,
} from "../query-action-family";
import type {
  QueryActionCommandPayload,
  QueryActionEffect,
  QueryActionEvent,
  QueryActionRejectCode,
  QueryActionState,
} from "../query-action-family";
import {
  decodeQueryActionEventPayload,
  encodeQueryActionCommandPayload,
  encodeQueryActionEffectPayload,
  encodeQueryActionEventPayload,
  getQueryActionCommandPayloadType,
} from "../query-action-family/protobuf-codec";
import {
  SourceApiActionStateSchema,
  decideSourceApiAction,
  reduceSourceApiAction,
} from "../source-api-action-family";
import type {
  SourceApiActionCommandPayload,
  SourceApiActionEffect,
  SourceApiActionEvent,
  SourceApiActionRejectCode,
  SourceApiActionState,
} from "../source-api-action-family";
import {
  decodeSourceApiActionEventPayload,
  encodeSourceApiActionCommandPayload,
  encodeSourceApiActionEffectPayload,
  encodeSourceApiActionEventPayload,
  getSourceApiActionCommandPayloadType,
} from "../source-api-action-family/protobuf-codec";
import type { WorkflowStorageCorruptRowError } from "./errors";
import {
  parseStoredWorkflowValue,
  toWorkflowProjectionJson,
} from "./serialization";
import type { WorkflowStoreAdapter } from "./types";

function collectDecodedValues<T>(
  values: readonly ResultType<T, WorkflowStorageCorruptRowError>[]
): ResultType<T[], WorkflowStorageCorruptRowError> {
  const decoded: T[] = [];

  for (const value of values) {
    if (value.isErr()) {
      return Result.err(value.error);
    }
    decoded.push(value.value);
  }

  return Result.ok(decoded);
}

function toQueryActionActionColumns(state: QueryActionState) {
  return {
    completedAt: state.completedAt,
    failureCode: state.failureCode,
    lastEventId: state.lastEventId,
    lastEventSequence: state.lastEventSequence,
    outcome: state.outcome,
    phase: state.phase,
    queryMode: state.queryMode,
    queryText: state.queryText,
    sourceDescriptorJson:
      state.sourceDescriptor === null
        ? null
        : toWorkflowProjectionJson(state.sourceDescriptor),
    startedAt: state.startedAt,
    usageRecordingStatus: state.usageRecordingStatus,
    validatedQuery: state.validatedQuery,
  };
}

function toSourceApiActionColumns(state: SourceApiActionState) {
  return {
    attemptNumber: state.attemptNumber,
    completedAt: state.completedAt,
    failureCode: state.failureCode,
    invokeMode: state.invokeMode,
    lastEventId: state.lastEventId,
    lastEventSequence: state.lastEventSequence,
    outcome: state.outcome,
    pageProgressJson:
      state.pageProgress === null
        ? null
        : toWorkflowProjectionJson(state.pageProgress),
    phase: state.phase,
    preparedRequestFingerprint: state.preparedRequestFingerprint,
    requestDescriptorJson:
      state.requestDescriptor === null
        ? null
        : toWorkflowProjectionJson(state.requestDescriptor),
    requestKind: state.requestKind,
    sourceDescriptorJson:
      state.sourceDescriptor === null
        ? null
        : toWorkflowProjectionJson(state.sourceDescriptor),
    startedAt: state.startedAt,
  };
}

export const queryActionStoreAdapter: WorkflowStoreAdapter<
  "query_action",
  QueryActionCommandPayload,
  QueryActionState,
  QueryActionEvent,
  QueryActionEffect,
  QueryActionRejectCode
> = {
  decide: decideQueryAction,
  encodeCommandPayload: encodeQueryActionCommandPayload,
  encodeEffectPayload: encodeQueryActionEffectPayload,
  family: "query_action",
  getCommandPayloadType: getQueryActionCommandPayloadType,
  insertAction: async ({ actionId, organizationId, state, tx }) => {
    await tx.insert(queryActions).values({
      id: actionId,
      organizationId,
      ...toQueryActionActionColumns(state),
    });
  },
  insertEvents: async ({ actionId, commandId, events, tx }) => {
    const inserted = await tx
      .insert(queryActionEvents)
      .values(
        events.map((event) => ({
          actionId,
          commandId,
          eventType: event.type,
          id: event.id,
          occurredAt: event.occurredAt,
          payloadBytes: encodeQueryActionEventPayload(event),
          sequence: event.sequence,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: queryActionEvents.id });

    return inserted.length === events.length;
  },
  loadEventsByCommandId: async (db, commandId) => {
    const rows = await db
      .select()
      .from(queryActionEvents)
      .where(eq(queryActionEvents.commandId, commandId))
      .orderBy(asc(queryActionEvents.sequence));

    return collectDecodedValues(rows.map(decodeQueryActionCommittedEvent));
  },
  loadHistoryByActionId: async (db, actionId) => {
    const rows = await db
      .select({
        eventRow: queryActionEvents,
        organizationId: workflowCommands.organizationId,
      })
      .from(queryActionEvents)
      .innerJoin(
        workflowCommands,
        eq(workflowCommands.id, queryActionEvents.commandId)
      )
      .where(eq(queryActionEvents.actionId, actionId))
      .orderBy(asc(queryActionEvents.sequence));

    if (rows.length === 0) {
      return Result.ok(null);
    }

    const firstRow = rows[0];
    if (!firstRow) {
      return Result.ok(null);
    }

    const events = collectDecodedValues(
      rows.map((row) => decodeQueryActionCommittedEvent(row.eventRow))
    );
    if (events.isErr()) {
      return Result.err(events.error);
    }

    return Result.ok({
      events: events.value,
      organizationId: firstRow.organizationId,
    });
  },
  loadLatestEventPointer: async (db, actionId) => {
    const row = await db.query.queryActionEvents.findFirst({
      orderBy: [desc(queryActionEvents.sequence)],
      where: eq(queryActionEvents.actionId, actionId),
    });

    return row === undefined
      ? null
      : {
          lastEventId: row.id,
          lastEventSequence: row.sequence,
        };
  },
  loadState: async (db, actionId) => {
    const row = await db.query.queryActions.findFirst({
      where: eq(queryActions.id, actionId),
    });

    return row === undefined ? Result.ok(null) : decodeQueryActionState(row);
  },
  repairAction: async ({
    actionId,
    organizationId,
    repairAnchor,
    state,
    tx,
  }) => {
    if (repairAnchor !== null) {
      const updated = await tx
        .update(queryActions)
        .set(toQueryActionActionColumns(state))
        .where(
          and(
            eq(queryActions.id, actionId),
            eq(queryActions.lastEventId, repairAnchor.lastEventId),
            eq(queryActions.lastEventSequence, repairAnchor.lastEventSequence)
          )
        )
        .returning({ id: queryActions.id });

      if (updated.length === 1) {
        return true;
      }
    }

    const inserted = await tx
      .insert(queryActions)
      .values({
        id: actionId,
        organizationId,
        ...toQueryActionActionColumns(state),
      })
      .onConflictDoNothing()
      .returning({ id: queryActions.id });

    return inserted.length === 1;
  },
  reduce: reduceQueryAction,
  updateAction: async ({
    actionId,
    expectedLastEventId,
    expectedLastEventSequence,
    state,
    tx,
  }) => {
    const updated = await tx
      .update(queryActions)
      .set(toQueryActionActionColumns(state))
      .where(
        and(
          eq(queryActions.id, actionId),
          eq(queryActions.lastEventId, expectedLastEventId),
          eq(queryActions.lastEventSequence, expectedLastEventSequence)
        )
      )
      .returning({ id: queryActions.id });

    return updated.length === 1;
  },
};

export const sourceApiActionStoreAdapter: WorkflowStoreAdapter<
  "source_api_action",
  SourceApiActionCommandPayload,
  SourceApiActionState,
  SourceApiActionEvent,
  SourceApiActionEffect,
  SourceApiActionRejectCode
> = {
  decide: decideSourceApiAction,
  encodeCommandPayload: encodeSourceApiActionCommandPayload,
  encodeEffectPayload: encodeSourceApiActionEffectPayload,
  family: "source_api_action",
  getCommandPayloadType: getSourceApiActionCommandPayloadType,
  insertAction: async ({ actionId, organizationId, state, tx }) => {
    await tx.insert(sourceApiActions).values({
      id: actionId,
      organizationId,
      ...toSourceApiActionColumns(state),
    });
  },
  insertEvents: async ({ actionId, commandId, events, tx }) => {
    const inserted = await tx
      .insert(sourceApiActionEvents)
      .values(
        events.map((event) => ({
          actionId,
          commandId,
          eventType: event.type,
          id: event.id,
          occurredAt: event.occurredAt,
          payloadBytes: encodeSourceApiActionEventPayload(event),
          sequence: event.sequence,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: sourceApiActionEvents.id });

    return inserted.length === events.length;
  },
  loadEventsByCommandId: async (db, commandId) => {
    const rows = await db
      .select()
      .from(sourceApiActionEvents)
      .where(eq(sourceApiActionEvents.commandId, commandId))
      .orderBy(asc(sourceApiActionEvents.sequence));

    return collectDecodedValues(rows.map(decodeSourceApiCommittedEvent));
  },
  loadHistoryByActionId: async (db, actionId) => {
    const rows = await db
      .select({
        eventRow: sourceApiActionEvents,
        organizationId: workflowCommands.organizationId,
      })
      .from(sourceApiActionEvents)
      .innerJoin(
        workflowCommands,
        eq(workflowCommands.id, sourceApiActionEvents.commandId)
      )
      .where(eq(sourceApiActionEvents.actionId, actionId))
      .orderBy(asc(sourceApiActionEvents.sequence));

    if (rows.length === 0) {
      return Result.ok(null);
    }

    const firstRow = rows[0];
    if (!firstRow) {
      return Result.ok(null);
    }

    const events = collectDecodedValues(
      rows.map((row) => decodeSourceApiCommittedEvent(row.eventRow))
    );
    if (events.isErr()) {
      return Result.err(events.error);
    }

    return Result.ok({
      events: events.value,
      organizationId: firstRow.organizationId,
    });
  },
  loadLatestEventPointer: async (db, actionId) => {
    const row = await db.query.sourceApiActionEvents.findFirst({
      orderBy: [desc(sourceApiActionEvents.sequence)],
      where: eq(sourceApiActionEvents.actionId, actionId),
    });

    return row === undefined
      ? null
      : {
          lastEventId: row.id,
          lastEventSequence: row.sequence,
        };
  },
  loadState: async (db, actionId) => {
    const row = await db.query.sourceApiActions.findFirst({
      where: eq(sourceApiActions.id, actionId),
    });

    return row === undefined
      ? Result.ok(null)
      : decodeSourceApiActionState(row);
  },
  repairAction: async ({
    actionId,
    organizationId,
    repairAnchor,
    state,
    tx,
  }) => {
    if (repairAnchor !== null) {
      const updated = await tx
        .update(sourceApiActions)
        .set(toSourceApiActionColumns(state))
        .where(
          and(
            eq(sourceApiActions.id, actionId),
            eq(sourceApiActions.lastEventId, repairAnchor.lastEventId),
            eq(
              sourceApiActions.lastEventSequence,
              repairAnchor.lastEventSequence
            )
          )
        )
        .returning({ id: sourceApiActions.id });

      if (updated.length === 1) {
        return true;
      }
    }

    const inserted = await tx
      .insert(sourceApiActions)
      .values({
        id: actionId,
        organizationId,
        ...toSourceApiActionColumns(state),
      })
      .onConflictDoNothing()
      .returning({ id: sourceApiActions.id });

    return inserted.length === 1;
  },
  reduce: reduceSourceApiAction,
  updateAction: async ({
    actionId,
    expectedLastEventId,
    expectedLastEventSequence,
    state,
    tx,
  }) => {
    const updated = await tx
      .update(sourceApiActions)
      .set(toSourceApiActionColumns(state))
      .where(
        and(
          eq(sourceApiActions.id, actionId),
          eq(sourceApiActions.lastEventId, expectedLastEventId),
          eq(sourceApiActions.lastEventSequence, expectedLastEventSequence)
        )
      )
      .returning({ id: sourceApiActions.id });

    return updated.length === 1;
  },
};

function decodeQueryActionState(
  row: typeof queryActions.$inferSelect
): ResultType<QueryActionState, WorkflowStorageCorruptRowError> {
  return parseStoredWorkflowValue({
    actionId: row.id,
    entity: "query_action_state",
    family: "query_action",
    repairAnchor: {
      lastEventId: row.lastEventId,
      lastEventSequence: row.lastEventSequence,
    },
    schema: QueryActionStateSchema,
    value: {
      completedAt: row.completedAt,
      failureCode: row.failureCode,
      lastEventId: row.lastEventId,
      lastEventSequence: row.lastEventSequence,
      outcome: row.outcome,
      phase: row.phase,
      queryMode: row.queryMode,
      queryText: row.queryText,
      sourceDescriptor: row.sourceDescriptorJson,
      startedAt: row.startedAt,
      usageRecordingStatus: row.usageRecordingStatus,
      validatedQuery: row.validatedQuery,
    },
  });
}

function decodeSourceApiActionState(
  row: typeof sourceApiActions.$inferSelect
): ResultType<SourceApiActionState, WorkflowStorageCorruptRowError> {
  return parseStoredWorkflowValue({
    actionId: row.id,
    entity: "source_api_action_state",
    family: "source_api_action",
    repairAnchor: {
      lastEventId: row.lastEventId,
      lastEventSequence: row.lastEventSequence,
    },
    schema: SourceApiActionStateSchema,
    value: {
      attemptNumber: row.attemptNumber,
      completedAt: row.completedAt,
      failureCode: row.failureCode,
      invokeMode: row.invokeMode,
      lastEventId: row.lastEventId,
      lastEventSequence: row.lastEventSequence,
      outcome: row.outcome,
      pageProgress: row.pageProgressJson,
      phase: row.phase,
      preparedRequestFingerprint: row.preparedRequestFingerprint,
      requestDescriptor: row.requestDescriptorJson,
      requestKind: row.requestKind,
      sourceDescriptor: row.sourceDescriptorJson,
      startedAt: row.startedAt,
    },
  });
}

function decodeQueryActionCommittedEvent(
  row: typeof queryActionEvents.$inferSelect
): ResultType<
  WorkflowCommittedEvent<QueryActionEvent>,
  WorkflowStorageCorruptRowError
> {
  return decodeQueryActionEventPayload(row.payloadBytes, {
    actionId: row.actionId,
    commandId: row.commandId,
    payloadType: row.eventType,
  }).map((event) => ({
    ...event,
    id: row.id,
    occurredAt: row.occurredAt,
    sequence: row.sequence,
  }));
}

function decodeSourceApiCommittedEvent(
  row: typeof sourceApiActionEvents.$inferSelect
): ResultType<
  WorkflowCommittedEvent<SourceApiActionEvent>,
  WorkflowStorageCorruptRowError
> {
  return decodeSourceApiActionEventPayload(row.payloadBytes, {
    actionId: row.actionId,
    commandId: row.commandId,
    payloadType: row.eventType,
  }).map((event) => ({
    ...event,
    id: row.id,
    occurredAt: row.occurredAt,
    sequence: row.sequence,
  }));
}
