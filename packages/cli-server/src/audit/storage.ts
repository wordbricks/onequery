import {
  TransactionRollbackError,
  and,
  asc,
  desc,
  eq,
  queryActionEvents,
  queryActions,
  sourceApiActionEvents,
  sourceApiActions,
  ulid,
  workflowCommands,
  workflowEffectDispatches,
} from "@onequery/db/server";
import type { Database, WorkflowJson } from "@onequery/db/server";
import { Result, TaggedError } from "better-result";
import { z } from "zod";

import type {
  SharedWorkflowRejectCode,
  WorkflowCommandEnvelope,
  WorkflowCommittedEvent,
  WorkflowDecision,
  WorkflowFamily,
  WorkflowStateBase,
} from "./kernel";
import { SHARED_WORKFLOW_REJECT_CODES } from "./kernel";
import {
  QueryActionEventSchema,
  QueryActionStateSchema,
  decideQueryAction,
  reduceQueryAction,
} from "./query-action-family";
import type {
  QueryActionCommand,
  QueryActionCommandPayload,
  QueryActionEffect,
  QueryActionEvent,
  QueryActionRejectCode,
  QueryActionState,
} from "./query-action-family";
import {
  SourceApiActionEventSchema,
  SourceApiActionStateSchema,
  decideSourceApiAction,
  reduceSourceApiAction,
} from "./source-api-action-family";
import type {
  SourceApiActionCommand,
  SourceApiActionCommandPayload,
  SourceApiActionEffect,
  SourceApiActionEvent,
  SourceApiActionRejectCode,
  SourceApiActionState,
} from "./source-api-action-family";

const MAX_STORAGE_COMMIT_ATTEMPTS = 5;

type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

type WorkflowActionRepairAnchor = {
  lastEventId: string;
  lastEventSequence: number;
};

type WorkflowActionHistory<Event extends { type: string }> = {
  events: readonly WorkflowCommittedEvent<Event>[];
  organizationId: string;
};

type StoredAcceptedWorkflowDecision<
  Family extends WorkflowFamily,
  Event extends { type: string },
> = {
  actionId: string;
  commandId: string;
  events: readonly WorkflowCommittedEvent<Event>[];
  family: Family;
  kind: "accepted";
};

type StoredRejectedWorkflowDecision<
  Family extends WorkflowFamily,
  RejectCode extends string,
> = {
  actionId: string | null;
  commandId: string;
  family: Family;
  kind: "rejected";
  rejectCode: RejectCode;
  rejectDetail?: string;
};

type StoredWorkflowDecisionCore<
  Family extends WorkflowFamily,
  Event extends { type: string },
  RejectCode extends string,
> =
  | StoredAcceptedWorkflowDecision<Family, Event>
  | StoredRejectedWorkflowDecision<Family, RejectCode>;

export type StoredWorkflowDecision<
  Family extends WorkflowFamily,
  Event extends { type: string },
  RejectCode extends string,
> = StoredWorkflowDecisionCore<Family, Event, RejectCode> & {
  idempotency: "fresh" | "replayed";
};

class WorkflowStorageReadError extends TaggedError("WorkflowStorageReadError")<{
  cause?: unknown;
  family: WorkflowFamily;
  message: string;
  operation: string;
}>() {
  constructor(input: {
    cause?: unknown;
    family: WorkflowFamily;
    operation: string;
  }) {
    super({
      ...(input.cause === undefined ? {} : { cause: input.cause }),
      family: input.family,
      message: `workflow storage read failed during ${input.operation} for ${input.family}`,
      operation: input.operation,
    });
  }
}

class WorkflowStorageWriteError extends TaggedError(
  "WorkflowStorageWriteError"
)<{
  actionId?: string;
  cause?: unknown;
  family: WorkflowFamily;
  message: string;
  operation: string;
}>() {
  constructor(input: {
    actionId?: string;
    cause?: unknown;
    family: WorkflowFamily;
    operation: string;
  }) {
    super({
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
      ...(input.cause === undefined ? {} : { cause: input.cause }),
      family: input.family,
      message: `workflow storage write failed during ${input.operation} for ${input.family}`,
      operation: input.operation,
    });
  }
}

class WorkflowStorageContentionError extends TaggedError(
  "WorkflowStorageContentionError"
)<{
  actionId?: string;
  attempts: number;
  family: WorkflowFamily;
  message: string;
}>() {
  constructor(input: {
    actionId?: string;
    attempts: number;
    family: WorkflowFamily;
  }) {
    super({
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
      attempts: input.attempts,
      family: input.family,
      message: `workflow storage could not commit ${input.family} after ${input.attempts} attempts`,
    });
  }
}

class WorkflowStorageCorruptRowError extends TaggedError(
  "WorkflowStorageCorruptRowError"
)<{
  actionId?: string;
  cause?: unknown;
  entity: string;
  family: WorkflowFamily;
  message: string;
  repairAnchor?: WorkflowActionRepairAnchor | null;
}>() {
  constructor(input: {
    actionId?: string;
    cause?: unknown;
    entity: string;
    family: WorkflowFamily;
    repairAnchor?: WorkflowActionRepairAnchor | null;
  }) {
    super({
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
      ...(input.cause === undefined ? {} : { cause: input.cause }),
      entity: input.entity,
      family: input.family,
      message: `workflow storage row is corrupt for ${input.family} ${input.entity}`,
      ...(input.repairAnchor === undefined
        ? {}
        : { repairAnchor: input.repairAnchor }),
    });
  }
}

export type WorkflowStorageError =
  | WorkflowStorageReadError
  | WorkflowStorageWriteError
  | WorkflowStorageContentionError;

type WorkflowStoreAdapter<
  Family extends WorkflowFamily,
  CommandPayload extends { type: string },
  State extends WorkflowStateBase<string, string>,
  Event extends { type: string },
  Effect extends { type: string },
  RejectCode extends string,
> = {
  decide: (
    state: State | null,
    command: WorkflowCommandEnvelope<Family, CommandPayload>
  ) => WorkflowDecision<Event, Effect, RejectCode>;
  family: Family;
  insertAction: (input: {
    actionId: string;
    organizationId: string;
    state: State;
    tx: DatabaseTransaction;
  }) => Promise<void>;
  insertEvents: (input: {
    actionId: string;
    commandId: string;
    events: readonly WorkflowCommittedEvent<Event>[];
    tx: DatabaseTransaction;
  }) => Promise<boolean>;
  loadEventsByCommandId: (
    db: Database,
    commandId: string
  ) => Promise<readonly WorkflowCommittedEvent<Event>[]>;
  loadHistoryByActionId: (
    db: Database,
    actionId: string
  ) => Promise<WorkflowActionHistory<Event> | null>;
  loadLatestEventPointer: (
    db: Database,
    actionId: string
  ) => Promise<WorkflowActionRepairAnchor | null>;
  loadState: (db: Database, actionId: string) => Promise<State | null>;
  repairAction: (input: {
    actionId: string;
    organizationId: string;
    repairAnchor: WorkflowActionRepairAnchor | null;
    state: State;
    tx: DatabaseTransaction;
  }) => Promise<boolean>;
  reduce: (state: State | null, event: WorkflowCommittedEvent<Event>) => State;
  updateAction: (input: {
    actionId: string;
    expectedLastEventId: string;
    expectedLastEventSequence: number;
    state: State;
    tx: DatabaseTransaction;
  }) => Promise<boolean>;
};

type TransactionCommitOutcome<
  Family extends WorkflowFamily,
  Event extends { type: string },
  RejectCode extends string,
> =
  | StoredAcceptedWorkflowDecision<Family, Event>
  | StoredRejectedWorkflowDecision<Family, RejectCode>
  | {
      kind: "race_lost";
    };

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
        : toWorkflowJson(state.sourceDescriptor),
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
      state.pageProgress === null ? null : toWorkflowJson(state.pageProgress),
    phase: state.phase,
    preparedRequestFingerprint: state.preparedRequestFingerprint,
    requestDescriptorJson:
      state.requestDescriptor === null
        ? null
        : toWorkflowJson(state.requestDescriptor),
    requestKind: state.requestKind,
    sourceDescriptorJson:
      state.sourceDescriptor === null
        ? null
        : toWorkflowJson(state.sourceDescriptor),
    startedAt: state.startedAt,
  };
}

const queryActionStoreAdapter: WorkflowStoreAdapter<
  "query_action",
  QueryActionCommandPayload,
  QueryActionState,
  QueryActionEvent,
  QueryActionEffect,
  QueryActionRejectCode
> = {
  decide: decideQueryAction,
  family: "query_action",
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
          payloadJson: toWorkflowEventPayloadJson(event),
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

    return rows.map(decodeQueryActionCommittedEvent);
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
      return null;
    }

    const firstRow = rows[0];
    if (!firstRow) {
      return null;
    }

    return {
      events: rows.map((row) => decodeQueryActionCommittedEvent(row.eventRow)),
      organizationId: firstRow.organizationId,
    };
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

    return row === undefined ? null : decodeQueryActionState(row);
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

const sourceApiActionStoreAdapter: WorkflowStoreAdapter<
  "source_api_action",
  SourceApiActionCommandPayload,
  SourceApiActionState,
  SourceApiActionEvent,
  SourceApiActionEffect,
  SourceApiActionRejectCode
> = {
  decide: decideSourceApiAction,
  family: "source_api_action",
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
          payloadJson: toWorkflowEventPayloadJson(event),
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

    return rows.map(decodeSourceApiCommittedEvent);
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
      return null;
    }

    const firstRow = rows[0];
    if (!firstRow) {
      return null;
    }

    return {
      events: rows.map((row) => decodeSourceApiCommittedEvent(row.eventRow)),
      organizationId: firstRow.organizationId,
    };
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

    return row === undefined ? null : decodeSourceApiActionState(row);
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

export async function storeQueryActionCommand(input: {
  command: QueryActionCommand;
  db: Database;
}) {
  return storeWorkflowCommand({
    adapter: queryActionStoreAdapter,
    command: input.command,
    db: input.db,
  });
}

export async function storeSourceApiActionCommand(input: {
  command: SourceApiActionCommand;
  db: Database;
}) {
  return storeWorkflowCommand({
    adapter: sourceApiActionStoreAdapter,
    command: input.command,
    db: input.db,
  });
}

async function storeWorkflowCommand<
  Family extends WorkflowFamily,
  CommandPayload extends { type: string },
  State extends WorkflowStateBase<string, string>,
  Event extends { type: string },
  Effect extends { type: string },
  RejectCode extends string,
>(input: {
  adapter: WorkflowStoreAdapter<
    Family,
    CommandPayload,
    State,
    Event,
    Effect,
    RejectCode
  >;
  command: WorkflowCommandEnvelope<Family, CommandPayload>;
  db: Database;
}): Promise<
  Result<
    StoredWorkflowDecision<Family, Event, RejectCode>,
    WorkflowStorageError
  >
> {
  const { adapter, command, db } = input;

  for (let attempt = 1; attempt <= MAX_STORAGE_COMMIT_ATTEMPTS; attempt += 1) {
    const storedDecision = await loadStoredWorkflowDecision({
      adapter,
      commandInvocationId: command.commandInvocationId,
      db,
    });

    if (storedDecision.isErr()) {
      return Result.err(storedDecision.error);
    }

    if (storedDecision.value !== null) {
      return Result.ok({
        ...storedDecision.value,
        idempotency: "replayed",
      });
    }

    const loadedState = await loadWorkflowState({
      actionId: command.actionId,
      adapter,
      db,
    });

    if (loadedState.isErr()) {
      return Result.err(loadedState.error);
    }

    const currentState = loadedState.value;
    const decision = adapter.decide(currentState, command);
    const actionId =
      decision.kind === "accepted"
        ? (command.actionId ?? ulid())
        : command.actionId;

    const commitResult = await commitWorkflowDecision({
      actionId,
      adapter,
      command,
      currentState,
      db,
      decision,
    });

    if (commitResult.isErr()) {
      return Result.err(commitResult.error);
    }

    if (commitResult.value.kind === "race_lost") {
      continue;
    }

    return Result.ok({
      ...commitResult.value,
      idempotency: "fresh",
    });
  }

  return Result.err(
    new WorkflowStorageContentionError({
      ...(command.actionId === null ? {} : { actionId: command.actionId }),
      attempts: MAX_STORAGE_COMMIT_ATTEMPTS,
      family: adapter.family,
    })
  );
}

async function loadStoredWorkflowDecision<
  Family extends WorkflowFamily,
  CommandPayload extends { type: string },
  State extends WorkflowStateBase<string, string>,
  Event extends { type: string },
  Effect extends { type: string },
  RejectCode extends string,
>(input: {
  adapter: WorkflowStoreAdapter<
    Family,
    CommandPayload,
    State,
    Event,
    Effect,
    RejectCode
  >;
  commandInvocationId: string;
  db: Database;
}): Promise<
  Result<
    StoredWorkflowDecisionCore<Family, Event, RejectCode> | null,
    WorkflowStorageError
  >
> {
  return Result.tryPromise({
    catch: (cause) =>
      new WorkflowStorageReadError({
        cause,
        family: input.adapter.family,
        operation: "load_command_journal",
      }),
    try: async () => {
      const storedCommand = await input.db.query.workflowCommands.findFirst({
        where: and(
          eq(workflowCommands.family, input.adapter.family),
          eq(workflowCommands.commandInvocationId, input.commandInvocationId)
        ),
      });

      if (storedCommand === undefined) {
        return null;
      }

      if (storedCommand.decisionKind === "rejected") {
        return {
          actionId: storedCommand.actionId,
          commandId: storedCommand.id,
          family: input.adapter.family,
          kind: "rejected",
          rejectCode: parseStoredSharedRejectCode(
            input.adapter.family,
            storedCommand.rejectCode
          ) as RejectCode,
          ...(storedCommand.rejectDetail === null
            ? {}
            : { rejectDetail: storedCommand.rejectDetail }),
        } satisfies StoredRejectedWorkflowDecision<Family, RejectCode>;
      }

      const events = await input.adapter.loadEventsByCommandId(
        input.db,
        storedCommand.id
      );

      return {
        actionId: requireStoredAcceptedActionId(storedCommand.actionId),
        commandId: storedCommand.id,
        events,
        family: input.adapter.family,
        kind: "accepted",
      } satisfies StoredAcceptedWorkflowDecision<Family, Event>;
    },
  });
}

async function loadWorkflowState<
  Family extends WorkflowFamily,
  CommandPayload extends { type: string },
  State extends WorkflowStateBase<string, string>,
  Event extends { type: string },
  Effect extends { type: string },
  RejectCode extends string,
>(input: {
  actionId: string | null;
  adapter: WorkflowStoreAdapter<
    Family,
    CommandPayload,
    State,
    Event,
    Effect,
    RejectCode
  >;
  db: Database;
}): Promise<Result<State | null, WorkflowStorageError>> {
  if (input.actionId === null) {
    return Result.ok(null);
  }

  let repairAnchor: WorkflowActionRepairAnchor | null = null;

  try {
    const loadedState = await input.adapter.loadState(input.db, input.actionId);

    if (loadedState !== null) {
      const latestEventPointer = await input.adapter.loadLatestEventPointer(
        input.db,
        input.actionId
      );

      if (hasMatchingRepairAnchor(loadedState, latestEventPointer)) {
        return Result.ok(loadedState);
      }

      repairAnchor = {
        lastEventId: loadedState.lastEventId,
        lastEventSequence: loadedState.lastEventSequence,
      };
    }
  } catch (cause) {
    if (cause instanceof WorkflowStorageCorruptRowError) {
      repairAnchor = cause.repairAnchor ?? null;
    } else {
      return Result.err(
        new WorkflowStorageReadError({
          cause,
          family: input.adapter.family,
          operation: "load_action_state",
        })
      );
    }
  }

  return rebuildWorkflowState({
    actionId: input.actionId,
    adapter: input.adapter,
    db: input.db,
    repairAnchor,
  });
}

async function rebuildWorkflowState<
  Family extends WorkflowFamily,
  CommandPayload extends { type: string },
  State extends WorkflowStateBase<string, string>,
  Event extends { type: string },
  Effect extends { type: string },
  RejectCode extends string,
>(input: {
  actionId: string;
  adapter: WorkflowStoreAdapter<
    Family,
    CommandPayload,
    State,
    Event,
    Effect,
    RejectCode
  >;
  db: Database;
  repairAnchor: WorkflowActionRepairAnchor | null;
}): Promise<Result<State | null, WorkflowStorageError>> {
  return Result.tryPromise({
    catch: (cause) =>
      new WorkflowStorageReadError({
        cause,
        family: input.adapter.family,
        operation: "rebuild_action_state",
      }),
    try: async () => {
      const history = await input.adapter.loadHistoryByActionId(
        input.db,
        input.actionId
      );

      if (history === null) {
        return null;
      }

      const rebuiltState = requireFoldedState(
        foldCommittedEvents({
          events: history.events,
          initialState: null,
          reduce: input.adapter.reduce,
        })
      );

      const repaired = await input.db.transaction((tx) =>
        input.adapter.repairAction({
          actionId: input.actionId,
          organizationId: history.organizationId,
          repairAnchor: input.repairAnchor,
          state: rebuiltState,
          tx,
        })
      );

      if (repaired) {
        return rebuiltState;
      }

      return input.adapter.loadState(input.db, input.actionId);
    },
  });
}

async function commitWorkflowDecision<
  Family extends WorkflowFamily,
  CommandPayload extends { type: string },
  State extends WorkflowStateBase<string, string>,
  Event extends { type: string },
  Effect extends { type: string },
  RejectCode extends string,
>(input: {
  actionId: string | null;
  adapter: WorkflowStoreAdapter<
    Family,
    CommandPayload,
    State,
    Event,
    Effect,
    RejectCode
  >;
  command: WorkflowCommandEnvelope<Family, CommandPayload>;
  currentState: State | null;
  db: Database;
  decision: WorkflowDecision<Event, Effect, RejectCode>;
}): Promise<
  Result<
    TransactionCommitOutcome<Family, Event, RejectCode>,
    WorkflowStorageError
  >
> {
  const { adapter, command, currentState, db, decision } = input;
  const actionId = input.actionId;

  let committedEvents: readonly WorkflowCommittedEvent<Event>[] = [];
  let foldedState: State | null = null;

  if (decision.kind === "accepted") {
    committedEvents = buildCommittedEvents({
      events: decision.events,
      occurredAt: command.observedAt,
      startingSequence: currentState?.lastEventSequence ?? 0,
    });
    foldedState = foldCommittedEvents({
      events: committedEvents,
      initialState: currentState,
      reduce: adapter.reduce,
    });
  }

  try {
    const committed = await db.transaction(async (tx) => {
      const insertedCommands = await tx
        .insert(workflowCommands)
        .values({
          actionId,
          actorSnapshotJson: {
            authMode: command.actorSnapshot.authMode,
            email: command.actorSnapshot.email,
            membershipRoles: [...command.actorSnapshot.membershipRoles],
            userId: command.actorSnapshot.userId,
          },
          causedByEventId: command.causedByEventId,
          commandInvocationId: command.commandInvocationId,
          commandPayloadJson: toWorkflowPayloadJson(command.commandPayload),
          commandType: command.commandPayload.type,
          createdAt: command.observedAt,
          decisionKind: decision.kind,
          family: adapter.family,
          organizationId: command.organizationId,
          rejectCode: decision.kind === "rejected" ? decision.rejectCode : null,
          rejectDetail:
            decision.kind === "rejected"
              ? (decision.rejectDetail ?? null)
              : null,
          requestId: command.requestId,
          surface: command.surface,
        })
        .onConflictDoNothing()
        .returning({ id: workflowCommands.id });

      if (insertedCommands.length === 0) {
        return { kind: "race_lost" } satisfies TransactionCommitOutcome<
          Family,
          Event,
          RejectCode
        >;
      }

      const insertedCommand = insertedCommands[0];
      if (!insertedCommand) {
        throw new WorkflowStorageWriteError({
          ...(actionId === null ? {} : { actionId }),
          family: adapter.family,
          operation: "insert_command",
        });
      }

      const commandId = insertedCommand.id;

      if (decision.kind === "rejected") {
        return {
          actionId,
          commandId,
          family: adapter.family,
          kind: "rejected",
          rejectCode: decision.rejectCode,
          ...(decision.rejectDetail === undefined
            ? {}
            : { rejectDetail: decision.rejectDetail }),
        } satisfies StoredRejectedWorkflowDecision<Family, RejectCode>;
      }

      const nextState = requireFoldedState(foldedState);
      const nextActionId = requireAcceptedActionId(actionId);
      const insertedEvents = await adapter.insertEvents({
        actionId: nextActionId,
        commandId,
        events: committedEvents,
        tx,
      });

      if (!insertedEvents) {
        tx.rollback();
      }

      const lastCommittedEvent = committedEvents.at(-1);
      if (!lastCommittedEvent) {
        throw new WorkflowStorageWriteError({
          actionId: nextActionId,
          family: adapter.family,
          operation: "build_committed_events",
        });
      }

      await insertWorkflowEffectDispatches({
        actionId: nextActionId,
        effects: decision.effects,
        family: adapter.family,
        occurredAt: command.observedAt,
        originEventId: lastCommittedEvent.id,
        tx,
      });

      if (currentState === null) {
        await adapter.insertAction({
          actionId: nextActionId,
          organizationId: command.organizationId,
          state: nextState,
          tx,
        });
      } else {
        const updated = await adapter.updateAction({
          actionId: nextActionId,
          expectedLastEventId: requireCurrentState(currentState).lastEventId,
          expectedLastEventSequence:
            requireCurrentState(currentState).lastEventSequence,
          state: nextState,
          tx,
        });

        if (!updated) {
          tx.rollback();
        }
      }

      return {
        actionId: nextActionId,
        commandId,
        events: committedEvents,
        family: adapter.family,
        kind: "accepted",
      } satisfies StoredAcceptedWorkflowDecision<Family, Event>;
    });

    return Result.ok(committed);
  } catch (error) {
    if (error instanceof WorkflowStorageWriteError) {
      return Result.err(error);
    }

    if (error instanceof TransactionRollbackError) {
      return Result.ok({ kind: "race_lost" });
    }

    return Result.err(
      new WorkflowStorageWriteError({
        ...(actionId === null ? {} : { actionId }),
        cause: error,
        family: adapter.family,
        operation: "commit_command",
      })
    );
  }
}

async function insertWorkflowEffectDispatches(input: {
  actionId: string;
  effects: readonly { type: string }[];
  family: WorkflowFamily;
  occurredAt: Date;
  originEventId: string;
  tx: DatabaseTransaction;
}) {
  if (input.effects.length === 0) {
    return;
  }

  // Comment: when a command emits multiple effects, they all anchor to the
  // last committed event in that command batch because that event is the latest
  // legality pointer a follow-up internal command must match.
  await input.tx.insert(workflowEffectDispatches).values(
    input.effects.map((effect, index) => ({
      actionId: input.actionId,
      attemptCount: 0,
      availableAt: input.occurredAt,
      createdAt: input.occurredAt,
      effectKey: `${input.family}:${input.originEventId}:${index + 1}`,
      effectType: effect.type,
      family: input.family,
      originEventId: input.originEventId,
      payloadJson: toWorkflowPayloadJson(effect),
      status: "pending" as const,
    }))
  );
}

function buildCommittedEvents<Event extends { type: string }>(input: {
  events: readonly [Event, ...Event[]];
  occurredAt: Date;
  startingSequence: number;
}) {
  return input.events.map(
    (event, index) =>
      ({
        ...event,
        id: ulid(),
        occurredAt: input.occurredAt,
        sequence: input.startingSequence + index + 1,
      }) as WorkflowCommittedEvent<Event>
  );
}

function foldCommittedEvents<State, Event extends { type: string }>(input: {
  events: readonly WorkflowCommittedEvent<Event>[];
  initialState: State | null;
  reduce: (state: State | null, event: WorkflowCommittedEvent<Event>) => State;
}) {
  return input.events.reduce<State | null>(
    (currentState, event) => input.reduce(currentState, event),
    input.initialState
  );
}

function decodeQueryActionState(
  row: typeof queryActions.$inferSelect
): QueryActionState {
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
): SourceApiActionState {
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
): WorkflowCommittedEvent<QueryActionEvent> {
  return {
    ...parseStoredWorkflowValue({
      entity: "query_action_event",
      family: "query_action",
      schema: QueryActionEventSchema,
      value: {
        type: row.eventType,
        ...row.payloadJson,
      },
    }),
    id: row.id,
    occurredAt: row.occurredAt,
    sequence: row.sequence,
  };
}

function decodeSourceApiCommittedEvent(
  row: typeof sourceApiActionEvents.$inferSelect
): WorkflowCommittedEvent<SourceApiActionEvent> {
  return {
    ...parseStoredWorkflowValue({
      entity: "source_api_action_event",
      family: "source_api_action",
      schema: SourceApiActionEventSchema,
      value: {
        type: row.eventType,
        ...row.payloadJson,
      },
    }),
    id: row.id,
    occurredAt: row.occurredAt,
    sequence: row.sequence,
  };
}

function parseStoredWorkflowValue<Schema extends z.ZodType>(input: {
  actionId?: string;
  entity: string;
  family: WorkflowFamily;
  repairAnchor?: WorkflowActionRepairAnchor | null;
  schema: Schema;
  value: unknown;
}): z.infer<Schema> {
  const parsed = input.schema.safeParse(input.value);

  if (parsed.success) {
    return parsed.data;
  }

  throw new WorkflowStorageCorruptRowError({
    ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
    cause: parsed.error,
    entity: input.entity,
    family: input.family,
    ...(input.repairAnchor === undefined
      ? {}
      : { repairAnchor: input.repairAnchor }),
  });
}

function parseStoredSharedRejectCode(
  family: WorkflowFamily,
  value: string | null
): SharedWorkflowRejectCode {
  return parseStoredWorkflowValue({
    entity: "workflow_command_reject_code",
    family,
    schema: z.enum(SHARED_WORKFLOW_REJECT_CODES),
    value,
  });
}

function toWorkflowPayloadJson<Value extends { type: string }>(value: Value) {
  const { type: _type, ...payload } = value as Value & Record<string, unknown>;

  return toWorkflowJson(payload);
}

function toWorkflowEventPayloadJson<Value extends { type: string }>(
  value: WorkflowCommittedEvent<Value>
) {
  const {
    id: _id,
    occurredAt: _occurredAt,
    sequence: _sequence,
    type: _type,
    ...payload
  } = value as WorkflowCommittedEvent<Value> & Record<string, unknown>;

  return toWorkflowJson(payload);
}

function toWorkflowJson(value: Record<string, unknown>): WorkflowJson {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function requireStoredAcceptedActionId(actionId: string | null) {
  if (actionId === null) {
    throw new Error("stored accepted workflow command action id is required");
  }

  return actionId;
}

function requireAcceptedActionId(actionId: string | null) {
  if (actionId === null) {
    throw new Error("accepted workflow action id is required");
  }

  return actionId;
}

function requireFoldedState<State>(state: State | null) {
  if (state === null) {
    throw new Error("folded workflow state is required");
  }

  return state;
}

function requireCurrentState<State>(state: State | null) {
  if (state === null) {
    throw new Error("current workflow state is required");
  }

  return state;
}

function hasMatchingRepairAnchor(
  state: Pick<WorkflowActionRepairAnchor, "lastEventId" | "lastEventSequence">,
  repairAnchor: WorkflowActionRepairAnchor | null
) {
  return (
    repairAnchor !== null &&
    state.lastEventId === repairAnchor.lastEventId &&
    state.lastEventSequence === repairAnchor.lastEventSequence
  );
}
