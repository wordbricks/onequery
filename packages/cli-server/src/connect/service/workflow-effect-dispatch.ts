import { and, eq, workflowEffectDispatches } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";

import type { WorkflowActorSnapshot, WorkflowFamily } from "../../audit";
import { toCliErrorMessage } from "../../observability";

const EFFECT_LEASE_DURATION_MS = 30_000;

export type LoadedWorkflowEffectDispatch<
  EffectType extends string,
  Effect extends { type: EffectType },
> = {
  attemptCount: number;
  effect: Effect;
  effectKey: string;
  id: string;
  originEventId: string;
  status: "completed" | "leased" | "pending";
};

type StoredAcceptedWorkflowDecision<Event extends { type: string }> = {
  actionId: string;
  commandId: string;
  events: readonly (Event & {
    id: string;
    occurredAt: Date;
    sequence: number;
  })[];
  family: WorkflowFamily;
  kind: "accepted";
};

export async function dispatchStoredWorkflowEffect<
  EffectUnion extends { type: string },
  EffectType extends EffectUnion["type"],
  CommandPayload extends { type: string },
  Event extends { type: string },
  Decision extends StoredAcceptedWorkflowDecision<Event>,
  StoredResultCommand extends { decision: Decision },
  TResult,
>(input: {
  actorSnapshot: WorkflowActorSnapshot;
  createCorruptionProblem: (detail: string, cause?: unknown) => Error;
  createProblem: (detail: string, cause?: unknown) => Error;
  currentDecision: Decision;
  db: Database;
  expectedEffectType: EffectType;
  family: WorkflowFamily;
  loadEffect: (input: {
    actionId: string;
    db: Database;
    expectedEffectType: EffectType;
    originEventId: string;
  }) => Promise<
    LoadedWorkflowEffectDispatch<
      EffectType,
      Extract<EffectUnion, { type: EffectType }>
    >
  >;
  loadStoredResultCommand: (input: {
    commandInvocationId: string;
    db: Database;
  }) => Promise<StoredResultCommand | null>;
  organizationId: string;
  replay: (input: {
    effect: Extract<EffectUnion, { type: EffectType }>;
    stored: StoredResultCommand;
  }) => Promise<TResult> | TResult;
  requestId: string;
  run: (effect: Extract<EffectUnion, { type: EffectType }>) => Promise<{
    commandPayload: CommandPayload;
    result: TResult;
  }>;
  storeResultCommand: (input: {
    actionId: string;
    actorSnapshot: WorkflowActorSnapshot;
    causedByEventId: string;
    commandInvocationId: string;
    commandPayload: CommandPayload;
    completedEffectId?: string;
    db: Database;
    organizationId: string;
    requestId: string;
    surface: "system";
  }) => Promise<Decision>;
}): Promise<{
  decision: Decision;
  effect: Extract<EffectUnion, { type: EffectType }>;
  result: TResult;
}> {
  const originEvent = requireLastCommittedEvent({
    createProblem: input.createCorruptionProblem,
    decision: input.currentDecision,
  });
  const effectDispatch = await input.loadEffect({
    actionId: input.currentDecision.actionId,
    db: input.db,
    expectedEffectType: input.expectedEffectType,
    originEventId: originEvent.id,
  });
  const resultCommandInvocationId = `${effectDispatch.effectKey}:result`;

  const stored = await input.loadStoredResultCommand({
    commandInvocationId: resultCommandInvocationId,
    db: input.db,
  });
  if (stored !== null) {
    if (effectDispatch.status !== "completed") {
      await completeWorkflowEffect({
        db: input.db,
        effectId: effectDispatch.id,
        createProblem: input.createProblem,
        family: input.family,
      });
    }

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
    throw input.createCorruptionProblem(
      `${input.family} effect ${effectDispatch.id} is ${effectDispatch.status} without a stored result command`
    );
  }

  await leaseWorkflowEffect({
    db: input.db,
    effectDispatch,
    createProblem: input.createProblem,
    family: input.family,
  });

  try {
    const outcome = await input.run(effectDispatch.effect);
    const decision = await input.storeResultCommand({
      actionId: input.currentDecision.actionId,
      actorSnapshot: input.actorSnapshot,
      causedByEventId: effectDispatch.originEventId,
      commandInvocationId: resultCommandInvocationId,
      commandPayload: outcome.commandPayload,
      completedEffectId: effectDispatch.id,
      db: input.db,
      organizationId: input.organizationId,
      requestId: input.requestId,
      surface: "system",
    });

    await completeWorkflowEffect({
      db: input.db,
      effectId: effectDispatch.id,
      createProblem: input.createProblem,
      family: input.family,
    });

    return {
      decision,
      effect: effectDispatch.effect,
      result: outcome.result,
    };
  } catch (error) {
    await releaseWorkflowEffect({
      db: input.db,
      effectId: effectDispatch.id,
      error,
    });
    throw error;
  }
}

function requireLastCommittedEvent<Event extends { type: string }>(input: {
  createProblem: (detail: string, cause?: unknown) => Error;
  decision: StoredAcceptedWorkflowDecision<Event>;
}) {
  const event = input.decision.events.at(-1);
  if (!event) {
    throw input.createProblem(
      `${input.decision.family} ${input.decision.commandId} committed without events`
    );
  }

  return event;
}

async function leaseWorkflowEffect<EffectType extends string>(input: {
  createProblem: (detail: string, cause?: unknown) => Error;
  db: Database;
  effectDispatch: Pick<
    LoadedWorkflowEffectDispatch<EffectType, { type: EffectType }>,
    "attemptCount" | "id"
  >;
  family: WorkflowFamily;
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
    throw input.createProblem(
      `${input.family} effect ${input.effectDispatch.id} could not be leased`
    );
  }
}

async function completeWorkflowEffect(input: {
  createProblem: (detail: string, cause?: unknown) => Error;
  db: Database;
  effectId: string;
  family: WorkflowFamily;
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
    throw input.createProblem(
      `${input.family} effect ${input.effectId} could not be completed`
    );
  }
}

async function releaseWorkflowEffect(input: {
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
