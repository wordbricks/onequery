import {
  and,
  asc,
  eq,
  sourceApiActionEvents,
  workflowCommands,
  workflowEffectDispatches,
} from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import type {
  PreparedSourceApi,
  SourceApiDescriptor,
  SourceApiDraft,
} from "@onequery/server/source-api";

import {
  SourceApiActionEffectSchema,
  SourceApiActionEventSchema,
  storeSourceApiActionCommand,
} from "../../../audit";
import type {
  SourceApiActionCommand,
  SourceApiActionCommandPayload,
  SourceApiActionEffect,
  SourceApiActionSourceDescriptor,
  WorkflowActorSnapshot,
} from "../../../audit";
import { toCliErrorMessage } from "../../../observability";
import { createCliServiceProblem } from "../result";
import type { CliHonoContext } from "../types";
import type { SourceApiServiceDependencies } from "./dependencies";
import { prepareSourceApiDraftResult } from "./runtime";
import type {
  DispatchedSourceApiActionEffect,
  LoadedPreparedSourceResult,
  LoadedSourceApiActionEffect,
  StoredAcceptedSourceApiActionDecision,
  StoredAcceptedSourceApiActionResultCommand,
} from "./workflow-types";

const EFFECT_LEASE_DURATION_MS = 30_000;

export async function dispatchStoredSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"],
  TResult,
>(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedSourceApiActionDecision;
  db: Database;
  expectedEffectType: EffectType;
  organizationId: string;
  replay: (input: {
    effect: Extract<SourceApiActionEffect, { type: EffectType }>;
    stored: StoredAcceptedSourceApiActionResultCommand;
  }) => Promise<TResult> | TResult;
  requestId: string;
  run: (
    effect: Extract<SourceApiActionEffect, { type: EffectType }>
  ) => Promise<{
    commandPayload: SourceApiActionCommandPayload;
    result: TResult;
  }>;
}): Promise<DispatchedSourceApiActionEffect<EffectType, TResult>> {
  // Comment: source_api_action still replays committed effect results inline on
  // the request path, so the effect row is the source of truth and the stored
  // result command is the replay cache.
  const originEvent = requireLastCommittedEvent(input.currentDecision);
  const effectDispatch = await loadRequiredSourceApiActionEffect({
    actionId: input.currentDecision.actionId,
    db: input.db,
    expectedEffectType: input.expectedEffectType,
    originEventId: originEvent.id,
  });

  const stored = await loadStoredAcceptedSourceApiActionResultCommand({
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
    throw createSourceApiAuditProblem(
      `source_api_action effect ${effectDispatch.id} is ${effectDispatch.status} without a stored result command`
    );
  }

  await leaseSourceApiActionEffect({
    db: input.db,
    effectDispatch,
  });

  try {
    const outcome = await input.run(effectDispatch.effect);
    const decision = await storeAcceptedSourceApiActionCommand({
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

    await completeSourceApiActionEffect({
      db: input.db,
      effectId: effectDispatch.id,
    });

    return {
      decision,
      effect: effectDispatch.effect,
      result: outcome.result,
    };
  } catch (error) {
    await releaseSourceApiActionEffect({
      db: input.db,
      effectId: effectDispatch.id,
      error,
    });
    throw error;
  }
}

export async function storeAcceptedSourceApiActionCommand(
  input: Omit<SourceApiActionCommand, "family" | "observedAt"> & {
    db: Database;
  }
): Promise<StoredAcceptedSourceApiActionDecision> {
  const stored = await storeSourceApiActionCommand({
    command: {
      ...input,
      family: "source_api_action",
      observedAt: new Date(),
    },
    db: input.db,
  });

  if (stored.isErr()) {
    throw createSourceApiAuditProblem(
      `source_api_action ${input.commandPayload.type} could not be stored`,
      stored.error
    );
  }

  if (stored.value.kind !== "accepted") {
    throw createSourceApiAuditProblem(
      `source_api_action ${input.commandPayload.type} was rejected with ${stored.value.rejectCode}`
    );
  }

  return stored.value;
}

export async function loadPreparedSourceConnection(input: {
  c: CliHonoContext;
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareDataSourceCredentials" | "runCliLoadSourceEffect"
  >;
  organizationId: string;
  source: Pick<
    SourceApiActionSourceDescriptor,
    "provider" | "sourceId" | "sourceKey"
  >;
}): Promise<LoadedPreparedSourceResult> {
  const source = await input.dependencies.runCliLoadSourceEffect({
    db: input.c.var.storage.db,
    effect: {
      kind: "load_source",
      organizationId: input.organizationId,
      sourceKey: input.source.sourceKey,
    },
  });

  if (source.kind === "not_found") {
    return {
      detail: `source "${input.source.sourceKey}" is no longer available`,
      kind: "not_found",
    };
  }

  if (
    source.source.id !== input.source.sourceId ||
    source.source.provider !== input.source.provider
  ) {
    return {
      detail: "Source API execution state no longer matches the current source",
      kind: "unavailable",
    };
  }

  const preparedCredentials =
    await input.dependencies.prepareDataSourceCredentials({
      dataSource: source.source,
      masterEncryptionKey: input.c.var.runtime.crypto.masterEncryptionKey,
    });

  if (preparedCredentials.isErr()) {
    return {
      detail: preparedCredentials.error.message,
      kind: "unavailable",
    };
  }

  return {
    kind: "loaded",
    source: {
      credentials: preparedCredentials.value.credentials,
      displayName: source.source.displayName,
      id: source.source.id,
      provider: source.source.provider,
      sourceKey: source.source.sourceKey,
    },
  };
}

export async function loadRequiredPreparedSourceConnection(input: {
  c: CliHonoContext;
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareDataSourceCredentials" | "runCliLoadSourceEffect"
  >;
  organizationId: string;
  source: Pick<
    SourceApiActionSourceDescriptor,
    "provider" | "sourceId" | "sourceKey"
  >;
}) {
  const loaded = await loadPreparedSourceConnection(input);

  if (loaded.kind !== "loaded") {
    throw createSourceApiAuditProblem(
      `source_api_action replay could not reload source "${input.source.sourceKey}" for a downstream effect`
    );
  }

  return loaded.source;
}

export async function loadRequiredPreparedSourceApi(input: {
  actor: import("@onequery/server/source-api").SourceApiActorContext;
  c: CliHonoContext;
  dependencies: SourceApiServiceDependencies;
  descriptor: SourceApiDescriptor | null;
  draft: SourceApiDraft;
  prepared: PreparedSourceApi | null;
  source: Pick<
    SourceApiActionSourceDescriptor,
    "provider" | "sourceId" | "sourceKey"
  >;
}) {
  if (input.prepared !== null) {
    return input.prepared;
  }

  const descriptor = requireResolvedSourceApiDescriptor(input.descriptor);
  const source = await loadRequiredPreparedSourceConnection({
    c: input.c,
    dependencies: input.dependencies,
    organizationId: input.actor.organizationId,
    source: input.source,
  });
  const prepared = await prepareSourceApiDraftResult(
    {
      actor: input.actor,
      descriptor,
      draft: input.draft,
      source,
    },
    input.dependencies
  );

  if (prepared.isErr()) {
    throw createSourceApiAuditProblem(
      "source_api_action replay could not rebuild the prepared request",
      prepared.error
    );
  }

  return prepared.value;
}

export function requireLastCommittedEvent(
  decision: StoredAcceptedSourceApiActionDecision
) {
  const event = decision.events.at(-1);
  if (!event) {
    throw createSourceApiAuditProblem(
      `source_api_action ${decision.commandId} committed without events`
    );
  }

  return event;
}

export function requireResolvedSourceApiDescriptor(
  descriptor: SourceApiDescriptor | null
) {
  if (descriptor === null) {
    throw createSourceApiAuditProblem(
      "source_api_action descriptor cache was missing during replay"
    );
  }

  return descriptor;
}

export function ensureCliServiceProblem(error: unknown) {
  if (error instanceof Error && error.name === "CliConnectProblem") {
    return error as ReturnType<typeof createCliServiceProblem>;
  }

  return createCliServiceProblem({
    ...(error === undefined ? {} : { cause: error }),
    detail: toCliErrorMessage(error),
    key: "SOURCE_API_EXECUTION_FAILED",
  });
}

export function createSourceApiAuditProblem(detail: string, cause?: unknown) {
  return createCliServiceProblem({
    ...(cause === undefined ? {} : { cause }),
    detail,
    key: "SOURCE_API_PREPARATION_FAILED",
  });
}

async function loadRequiredSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"],
>(input: {
  actionId: string;
  db: Database;
  expectedEffectType: EffectType;
  originEventId: string;
}): Promise<LoadedSourceApiActionEffect<EffectType>> {
  const [row] = await input.db
    .select()
    .from(workflowEffectDispatches)
    .where(
      and(
        eq(workflowEffectDispatches.actionId, input.actionId),
        eq(workflowEffectDispatches.family, "source_api_action"),
        eq(workflowEffectDispatches.originEventId, input.originEventId)
      )
    )
    .orderBy(
      asc(workflowEffectDispatches.createdAt),
      asc(workflowEffectDispatches.id)
    )
    .limit(1);

  if (!row) {
    throw createSourceApiAuditProblem(
      `source_api_action effect ${input.expectedEffectType} is missing for origin event ${input.originEventId}`
    );
  }

  const parsedEffect = SourceApiActionEffectSchema.safeParse({
    type: row.effectType,
    ...row.payloadJson,
  });

  if (!parsedEffect.success) {
    throw createSourceApiAuditProblem(
      `source_api_action effect ${row.effectType} payload is corrupt`,
      parsedEffect.error
    );
  }

  if (parsedEffect.data.type !== input.expectedEffectType) {
    throw createSourceApiAuditProblem(
      `source_api_action expected effect ${input.expectedEffectType} but loaded ${parsedEffect.data.type}`
    );
  }

  return {
    attemptCount: row.attemptCount,
    effect: parsedEffect.data as Extract<
      SourceApiActionEffect,
      { type: EffectType }
    >,
    effectKey: row.effectKey,
    id: row.id,
    originEventId: row.originEventId,
    status: row.status,
  };
}

async function loadStoredAcceptedSourceApiActionResultCommand(input: {
  commandInvocationId: string;
  db: Database;
}): Promise<StoredAcceptedSourceApiActionResultCommand | null> {
  const storedCommand = await input.db.query.workflowCommands.findFirst({
    where: and(
      eq(workflowCommands.family, "source_api_action"),
      eq(workflowCommands.commandInvocationId, input.commandInvocationId)
    ),
  });

  if (storedCommand === undefined) {
    return null;
  }

  if (storedCommand.decisionKind !== "accepted") {
    throw createSourceApiAuditProblem(
      `source_api_action stored result command ${input.commandInvocationId} was unexpectedly rejected`
    );
  }

  if (storedCommand.actionId === null) {
    throw createSourceApiAuditProblem(
      `source_api_action stored result command ${input.commandInvocationId} is missing its action id`
    );
  }

  const events = await input.db
    .select()
    .from(sourceApiActionEvents)
    .where(eq(sourceApiActionEvents.commandId, storedCommand.id))
    .orderBy(asc(sourceApiActionEvents.sequence));

  return {
    commandPayload: {
      type: storedCommand.commandType,
      ...storedCommand.commandPayloadJson,
    },
    decision: {
      actionId: storedCommand.actionId,
      commandId: storedCommand.id,
      events: events.map((row) => {
        const parsed = SourceApiActionEventSchema.safeParse({
          type: row.eventType,
          ...row.payloadJson,
        });
        if (!parsed.success) {
          throw createSourceApiAuditProblem(
            `source_api_action stored result command ${input.commandInvocationId} has a corrupt ${row.eventType} event payload`,
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
      family: "source_api_action",
      idempotency: "replayed" as const,
      kind: "accepted" as const,
    },
  };
}

async function leaseSourceApiActionEffect(input: {
  db: Database;
  effectDispatch: Pick<LoadedSourceApiActionEffect, "attemptCount" | "id">;
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
    throw createSourceApiAuditProblem(
      `source_api_action effect ${input.effectDispatch.id} could not be leased`
    );
  }
}

async function completeSourceApiActionEffect(input: {
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
    throw createSourceApiAuditProblem(
      `source_api_action effect ${input.effectId} could not be completed`
    );
  }
}

async function releaseSourceApiActionEffect(input: {
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
