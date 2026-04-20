export const WORKFLOW_FAMILIES = ["query_action", "source_api_action"] as const;
export type WorkflowFamily = (typeof WORKFLOW_FAMILIES)[number];

export const WORKFLOW_SURFACES = ["cli", "web", "agent", "system"] as const;
export type WorkflowSurface = (typeof WORKFLOW_SURFACES)[number];

export const WORKFLOW_OUTCOMES = ["pending", "succeeded", "failed"] as const;
export type WorkflowOutcome = (typeof WORKFLOW_OUTCOMES)[number];

export const SHARED_WORKFLOW_REJECT_CODES = [
  "unknown_action",
  "invalid_phase",
  "causation_mismatch",
] as const;
export type SharedWorkflowRejectCode =
  (typeof SHARED_WORKFLOW_REJECT_CODES)[number];

export type WorkflowActorSnapshot = {
  authMode: string | null;
  email: string | null;
  membershipRoles: readonly string[];
  userId: string | null;
};

export type WorkflowStateBase<
  Phase extends string,
  FailureCode extends string,
> = {
  phase: Phase;
  outcome: WorkflowOutcome;
  failureCode: FailureCode | null;
  startedAt: Date;
  completedAt: Date | null;
  lastEventId: string;
  lastEventSequence: number;
};

export type WorkflowCommandEnvelope<
  Family extends WorkflowFamily,
  CommandPayload extends { type: string },
> = {
  family: Family;
  surface: WorkflowSurface;
  organizationId: string;
  actorSnapshot: WorkflowActorSnapshot;
  commandInvocationId: string;
  requestId: string;
  actionId: string | null;
  causedByEventId: string | null;
  observedAt: Date;
  commandPayload: CommandPayload;
};

export type WorkflowCommittedEvent<Event extends { type: string }> = Event & {
  id: string;
  sequence: number;
  occurredAt: Date;
};

export type WorkflowAcceptedDecision<
  Event extends { type: string },
  Effect extends { type: string },
> = {
  kind: "accepted";
  events: readonly [Event, ...Event[]];
  effects: readonly Effect[];
};

export type WorkflowRejectedDecision<RejectCode extends string> = {
  kind: "rejected";
  rejectCode: RejectCode;
  rejectDetail?: string;
};

export type WorkflowDecision<
  Event extends { type: string },
  Effect extends { type: string },
  RejectCode extends string,
> =
  | WorkflowAcceptedDecision<Event, Effect>
  | WorkflowRejectedDecision<RejectCode>;

export function acceptWorkflowDecision<
  Event extends { type: string },
  Effect extends { type: string },
>(input: {
  events: readonly [Event, ...Event[]];
  effects?: readonly Effect[];
}): WorkflowAcceptedDecision<Event, Effect> {
  return {
    effects: input.effects ?? [],
    events: input.events,
    kind: "accepted",
  };
}

export function rejectWorkflowDecision<RejectCode extends string>(input: {
  rejectCode: RejectCode;
  rejectDetail?: string;
}): WorkflowRejectedDecision<RejectCode> {
  return {
    kind: "rejected",
    rejectCode: input.rejectCode,
    ...(input.rejectDetail === undefined
      ? {}
      : { rejectDetail: input.rejectDetail }),
  };
}

export function rejectUnknownAction() {
  return rejectWorkflowDecision<SharedWorkflowRejectCode>({
    rejectCode: "unknown_action",
  });
}

export function rejectInvalidPhase(detail?: string) {
  return rejectWorkflowDecision<SharedWorkflowRejectCode>({
    ...(detail === undefined ? {} : { rejectDetail: detail }),
    rejectCode: "invalid_phase",
  });
}

export function rejectCausationMismatch(detail?: string) {
  return rejectWorkflowDecision<SharedWorkflowRejectCode>({
    ...(detail === undefined ? {} : { rejectDetail: detail }),
    rejectCode: "causation_mismatch",
  });
}

export function hasMatchingCausation(
  state: Pick<WorkflowStateBase<string, string>, "lastEventId">,
  causedByEventId: string | null
): boolean {
  return causedByEventId !== null && causedByEventId === state.lastEventId;
}

export function appendEventMetadata<Event extends { type: string }>(
  event: Event,
  metadata: Pick<
    WorkflowCommittedEvent<Event>,
    "id" | "occurredAt" | "sequence"
  >
): WorkflowCommittedEvent<Event> {
  return {
    ...event,
    id: metadata.id,
    occurredAt: metadata.occurredAt,
    sequence: metadata.sequence,
  };
}
