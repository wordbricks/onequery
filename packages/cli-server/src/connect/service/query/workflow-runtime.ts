import {
  and,
  asc,
  eq,
  queryActionEvents,
  workflowCommands,
  workflowEffectDispatches,
} from "@onequery/db/server";
import type { Database, DatabaseCredentials } from "@onequery/db/server";

import {
  QueryActionEffectSchema,
  QueryActionEventSchema,
  storeQueryActionCommand,
} from "../../../audit";
import type {
  QueryActionCommand,
  QueryActionEffect,
  QueryActionSourceDescriptor,
} from "../../../audit";
import type { CliQuerySourceRecord } from "../../../domain/workflows";
import { toCliErrorMessage } from "../../../observability";
import { createCliServiceProblem } from "../result";
import type {
  CliQueryExecutionDispatch,
  DispatchedQueryActionEffect,
  LoadedQueryActionEffect,
  StoredAcceptedQueryActionDecision,
  StoredAcceptedQueryActionResultCommand,
} from "./workflow-types";

const EFFECT_LEASE_DURATION_MS = 30_000;

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
  // Comment: query requests still run synchronously on the request path, so
  // they lease and dispatch the already-committed outbox row inline here until
  // the shared background dispatcher lands.
  const originEvent = requireLastCommittedEvent(input.currentDecision);
  const effectDispatch = await loadRequiredQueryActionEffect({
    actionId: input.currentDecision.actionId,
    db: input.db,
    expectedEffectType: input.expectedEffectType,
    originEventId: originEvent.id,
  });

  const stored = await loadStoredAcceptedQueryActionResultCommand({
    commandInvocationId: `${effectDispatch.effectKey}:result`,
    db: input.db,
  });
  if (stored !== null) {
    return {
      decision: stored.decision,
      effect: effectDispatch.effect,
      result: await input.replay({
        effect: effectDispatch.effect,
        stored,
      }),
    };
  }

  if (effectDispatch.status !== "pending") {
    throw createQueryAuditProblem(
      `query_action effect ${effectDispatch.id} is ${effectDispatch.status} without a stored result command`
    );
  }

  await leaseQueryActionEffect({
    db: input.db,
    effectDispatch,
  });

  try {
    const outcome = await input.run(effectDispatch.effect);
    const decision = await storeAcceptedQueryActionCommand({
      actionId: input.currentDecision.actionId,
      actorSnapshot: input.actorSnapshot,
      causedByEventId: effectDispatch.originEventId,
      commandInvocationId: `${effectDispatch.effectKey}:result`,
      commandPayload: outcome.commandPayload,
      db: input.db,
      organizationId: input.organizationId,
      requestId: input.requestId,
      surface: "system",
    });

    await completeQueryActionEffect({
      db: input.db,
      effectId: effectDispatch.id,
    });

    return {
      decision,
      effect: effectDispatch.effect,
      result: outcome.result,
    };
  } catch (error) {
    await releaseQueryActionEffect({
      db: input.db,
      effectId: effectDispatch.id,
      error,
    });
    throw error;
  }
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
    throw createQueryAuditProblem(
      `query_action ${decision.commandId} committed without events`
    );
  }

  return event;
}

export function createQueryAuditProblem(detail: string, cause?: unknown) {
  return createCliServiceProblem({
    ...(cause === undefined ? {} : { cause }),
    detail,
    key: "QUERY_PREPARATION_FAILED",
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
    throw createQueryAuditProblem(
      `query_action effect ${input.expectedEffectType} is missing for origin event ${input.originEventId}`
    );
  }

  const parsedEffect = QueryActionEffectSchema.safeParse({
    type: row.effectType,
    ...row.payloadJson,
  });
  if (!parsedEffect.success) {
    throw createQueryAuditProblem(
      `query_action effect ${row.effectType} payload is corrupt`,
      parsedEffect.error
    );
  }

  if (parsedEffect.data.type !== input.expectedEffectType) {
    throw createQueryAuditProblem(
      `query_action expected effect ${input.expectedEffectType} but loaded ${parsedEffect.data.type}`
    );
  }

  return {
    attemptCount: row.attemptCount,
    effect: parsedEffect.data as Extract<
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
    throw createQueryAuditProblem(
      `query_action stored result command ${input.commandInvocationId} was unexpectedly rejected`
    );
  }

  if (storedCommand.actionId === null) {
    throw createQueryAuditProblem(
      `query_action stored result command ${input.commandInvocationId} is missing its action id`
    );
  }

  const events = await input.db
    .select()
    .from(queryActionEvents)
    .where(eq(queryActionEvents.commandId, storedCommand.id))
    .orderBy(asc(queryActionEvents.sequence));

  return {
    commandPayload: {
      type: storedCommand.commandType,
      ...storedCommand.commandPayloadJson,
    },
    decision: {
      actionId: storedCommand.actionId,
      commandId: storedCommand.id,
      events: events.map((row) => {
        const parsed = QueryActionEventSchema.safeParse({
          type: row.eventType,
          ...row.payloadJson,
        });
        if (!parsed.success) {
          throw createQueryAuditProblem(
            `query_action stored result command ${input.commandInvocationId} has a corrupt ${row.eventType} event payload`,
            parsed.error
          );
        }

        return {
          ...parsed.data,
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

async function leaseQueryActionEffect(input: {
  db: Database;
  effectDispatch: Pick<LoadedQueryActionEffect, "attemptCount" | "id">;
}) {
  const leasedUntil = new Date(Date.now() + EFFECT_LEASE_DURATION_MS);
  const leased = await input.db
    .update(workflowEffectDispatches)
    .set({
      attemptCount: input.effectDispatch.attemptCount + 1,
      lastErrorCode: null,
      lastErrorDetail: null,
      leasedUntil,
      status: "leased",
    })
    .where(
      and(
        eq(workflowEffectDispatches.id, input.effectDispatch.id),
        eq(workflowEffectDispatches.status, "pending")
      )
    )
    .returning({ id: workflowEffectDispatches.id });

  if (leased.length !== 1) {
    throw createQueryAuditProblem(
      `query_action effect ${input.effectDispatch.id} could not be leased`
    );
  }
}

async function completeQueryActionEffect(input: {
  db: Database;
  effectId: string;
}) {
  const completedAt = new Date();
  const completed = await input.db
    .update(workflowEffectDispatches)
    .set({
      completedAt,
      lastErrorCode: null,
      lastErrorDetail: null,
      leasedUntil: null,
      status: "completed",
    })
    .where(eq(workflowEffectDispatches.id, input.effectId))
    .returning({ id: workflowEffectDispatches.id });

  if (completed.length !== 1) {
    throw createQueryAuditProblem(
      `query_action effect ${input.effectId} could not be completed`
    );
  }
}

async function releaseQueryActionEffect(input: {
  db: Database;
  effectId: string;
  error: unknown;
}) {
  await input.db
    .update(workflowEffectDispatches)
    .set({
      availableAt: new Date(),
      lastErrorCode: "dispatch_failed",
      lastErrorDetail: toCliErrorMessage(input.error),
      leasedUntil: null,
      status: "pending",
    })
    .where(eq(workflowEffectDispatches.id, input.effectId));
}
