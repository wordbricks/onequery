import {
  and,
  asc,
  eq,
  queryActionEvents,
  workflowCommands,
  workflowEffectDispatches,
} from "@onequery/db/server";
import type { Database, DatabaseCredentials } from "@onequery/db/server";

import { storeQueryActionCommand } from "../../../audit";
import type {
  QueryActionCommand,
  QueryActionEffect,
  QueryActionEvent,
  QueryActionSourceDescriptor,
} from "../../../audit";
import {
  decodeQueryActionCommandPayload,
  decodeQueryActionEffectPayload,
  decodeQueryActionEventPayload,
} from "../../../audit/query-action-family/protobuf-codec";
import type { CliQuerySourceRecord } from "../../../domain/workflows";
import {
  createWorkflowAuditCorruptionFailure,
  createWorkflowAuditFailure,
} from "../workflow-audit-failure";
import { dispatchStoredWorkflowEffect } from "../workflow-effect-dispatch";
import type {
  CliQueryExecutionDispatch,
  DispatchedQueryActionEffect,
  LoadedQueryActionEffect,
  StoredAcceptedQueryActionDecision,
  StoredAcceptedQueryActionResultCommand,
} from "./workflow-types";

export async function dispatchStoredQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
  TResult,
>(input: {
  actorSnapshot: QueryActionCommand["actorSnapshot"];
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  expectedEffectType: EffectType;
  organizationId: string;
  replay: (input: {
    effect: Extract<QueryActionEffect, { type: EffectType }>;
    stored: StoredAcceptedQueryActionResultCommand;
  }) => Promise<TResult> | TResult;
  requestId: string;
  run: (effect: Extract<QueryActionEffect, { type: EffectType }>) => Promise<{
    commandPayload: QueryActionCommand["commandPayload"];
    result: TResult;
  }>;
}): Promise<DispatchedQueryActionEffect<EffectType, TResult>> {
  return dispatchStoredWorkflowEffect<
    QueryActionEffect,
    EffectType,
    QueryActionCommand["commandPayload"],
    QueryActionEvent,
    StoredAcceptedQueryActionDecision,
    StoredAcceptedQueryActionResultCommand,
    TResult
  >({
    ...input,
    createCorruptionProblem: createQueryAuditCorruptionProblem,
    createProblem: createQueryAuditProblem,
    family: "query_action",
    loadEffect: loadRequiredQueryActionEffect,
    loadStoredResultCommand: loadStoredAcceptedQueryActionResultCommand,
    storeResultCommand: storeAcceptedQueryActionCommand,
  });
}

export async function storeAcceptedQueryActionCommand(
  input: Omit<QueryActionCommand, "family" | "observedAt"> & {
    db: Database;
  }
): Promise<StoredAcceptedQueryActionDecision> {
  const stored = await storeQueryActionCommand({
    command: {
      ...input,
      family: "query_action",
      observedAt: new Date(),
    },
    db: input.db,
  });

  if (stored.isErr()) {
    throw createQueryAuditProblem(
      `query_action ${input.commandPayload.type} could not be stored`,
      stored.error
    );
  }

  if (stored.value.kind !== "accepted") {
    throw createQueryAuditProblem(
      `query_action ${input.commandPayload.type} was rejected with ${stored.value.rejectCode}`
    );
  }

  return stored.value;
}

export async function loadRequiredCliQuerySourceRecord(input: {
  cachedSource: CliQuerySourceRecord | null;
  dispatch: Pick<CliQueryExecutionDispatch, "loadSource">;
  sourceDescriptor: QueryActionSourceDescriptor;
}): Promise<CliQuerySourceRecord> {
  if (input.cachedSource !== null) {
    return input.cachedSource;
  }

  const loaded = await input.dispatch.loadSource({
    kind: "load_source",
    organizationId: input.sourceDescriptor.organizationId,
    sourceKey: input.sourceDescriptor.sourceKey,
  });

  if (loaded.kind !== "found") {
    throw createQueryAuditProblem(
      `query_action replay could not reload source "${input.sourceDescriptor.sourceKey}" for a downstream effect`
    );
  }

  if (
    loaded.source.id !== input.sourceDescriptor.sourceId ||
    loaded.source.organizationId !== input.sourceDescriptor.organizationId ||
    loaded.source.provider !== input.sourceDescriptor.provider ||
    loaded.source.sourceKey !== input.sourceDescriptor.sourceKey
  ) {
    throw createQueryAuditProblem(
      `query_action replay reloaded source "${input.sourceDescriptor.sourceKey}" with a mismatched identity`
    );
  }

  return loaded.source;
}

export async function loadRequiredCliQueryCredentials(input: {
  cachedCredentials: DatabaseCredentials | null;
  dispatch: Pick<CliQueryExecutionDispatch, "loadCredentials">;
  source: CliQuerySourceRecord;
}): Promise<DatabaseCredentials> {
  if (input.cachedCredentials !== null) {
    return input.cachedCredentials;
  }

  const loaded = await input.dispatch.loadCredentials({
    kind: "load_credentials",
    source: input.source,
  });

  if (loaded.kind !== "credentials_loaded") {
    throw createQueryAuditProblem(
      `query_action replay could not reload credentials for source "${input.source.sourceKey}"`
    );
  }

  return loaded.credentials;
}

export function requireLastCommittedEvent(
  decision: StoredAcceptedQueryActionDecision
) {
  const event = decision.events.at(-1);
  if (!event) {
    throw createQueryAuditCorruptionProblem(
      `query_action ${decision.commandId} committed without events`
    );
  }

  return event;
}

export function createQueryAuditProblem(detail: string, cause?: unknown) {
  return createWorkflowAuditFailure({
    cause,
    detail,
    keys: {
      corrupt: "QUERY_WORKFLOW_CORRUPT",
      internal: "QUERY_WORKFLOW_INTERNAL",
    },
  });
}

export function createQueryAuditCorruptionProblem(
  detail: string,
  cause?: unknown
) {
  return createWorkflowAuditCorruptionFailure({
    cause,
    detail,
    key: "QUERY_WORKFLOW_CORRUPT",
  });
}

async function loadRequiredQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
>(input: {
  actionId: string;
  db: Database;
  expectedEffectType: EffectType;
  originEventId: string;
}): Promise<LoadedQueryActionEffect<EffectType>> {
  const [row] = await input.db
    .select()
    .from(workflowEffectDispatches)
    .where(
      and(
        eq(workflowEffectDispatches.actionId, input.actionId),
        eq(workflowEffectDispatches.family, "query_action"),
        eq(workflowEffectDispatches.originEventId, input.originEventId)
      )
    )
    .orderBy(
      asc(workflowEffectDispatches.createdAt),
      asc(workflowEffectDispatches.id)
    )
    .limit(1);

  if (!row) {
    throw createQueryAuditCorruptionProblem(
      `query_action effect ${input.expectedEffectType} is missing for origin event ${input.originEventId}`
    );
  }

  const decodedEffect = decodeQueryActionEffectPayload(row.payloadBytes, {
    actionId: input.actionId,
    payloadType: row.effectType,
  });
  if (decodedEffect.isErr()) {
    throw createQueryAuditCorruptionProblem(
      `query_action effect ${row.effectType} payload is corrupt`,
      decodedEffect.error
    );
  }

  if (decodedEffect.value.type !== input.expectedEffectType) {
    throw createQueryAuditCorruptionProblem(
      `query_action expected effect ${input.expectedEffectType} but loaded ${decodedEffect.value.type}`
    );
  }

  return {
    attemptCount: row.attemptCount,
    effect: decodedEffect.value as Extract<
      QueryActionEffect,
      { type: EffectType }
    >,
    effectKey: row.effectKey,
    id: row.id,
    originEventId: row.originEventId,
    status: row.status,
  };
}

async function loadStoredAcceptedQueryActionResultCommand(input: {
  commandInvocationId: string;
  db: Database;
}): Promise<StoredAcceptedQueryActionResultCommand | null> {
  const storedCommand = await input.db.query.workflowCommands.findFirst({
    where: and(
      eq(workflowCommands.family, "query_action"),
      eq(workflowCommands.commandInvocationId, input.commandInvocationId)
    ),
  });

  if (storedCommand === undefined) {
    return null;
  }

  if (storedCommand.decisionKind !== "accepted") {
    throw createQueryAuditCorruptionProblem(
      `query_action stored result command ${input.commandInvocationId} was unexpectedly rejected`
    );
  }

  if (storedCommand.actionId === null) {
    throw createQueryAuditCorruptionProblem(
      `query_action stored result command ${input.commandInvocationId} is missing its action id`
    );
  }

  const events = await input.db
    .select()
    .from(queryActionEvents)
    .where(eq(queryActionEvents.commandId, storedCommand.id))
    .orderBy(asc(queryActionEvents.sequence));

  const commandPayload = decodeQueryActionCommandPayload(
    storedCommand.commandPayloadBytes,
    {
      actionId: storedCommand.actionId,
      commandId: storedCommand.id,
      payloadType: storedCommand.commandType,
    }
  );
  if (commandPayload.isErr()) {
    throw createQueryAuditCorruptionProblem(
      `query_action stored result command ${input.commandInvocationId} has a corrupt command payload`,
      commandPayload.error
    );
  }

  return {
    commandPayload: commandPayload.value,
    decision: {
      actionId: storedCommand.actionId,
      commandId: storedCommand.id,
      events: events.map((row) => {
        const decoded = decodeQueryActionEventPayload(row.payloadBytes, {
          actionId: row.actionId,
          commandId: row.commandId,
          payloadType: row.eventType,
        });
        if (decoded.isErr()) {
          throw createQueryAuditCorruptionProblem(
            `query_action stored result command ${input.commandInvocationId} has a corrupt ${row.eventType} event payload`,
            decoded.error
          );
        }

        return {
          ...decoded.value,
          id: row.id,
          occurredAt: row.occurredAt,
          sequence: row.sequence,
        };
      }),
      family: "query_action",
      idempotency: "replayed" as const,
      kind: "accepted" as const,
    },
  };
}
