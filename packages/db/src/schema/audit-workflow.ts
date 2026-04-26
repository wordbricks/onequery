export const WORKFLOW_FAMILIES = ["query_action", "source_api_action"] as const;
export type WorkflowFamily = (typeof WORKFLOW_FAMILIES)[number];

export const WORKFLOW_SURFACES = ["cli", "web", "agent", "system"] as const;
export type WorkflowSurface = (typeof WORKFLOW_SURFACES)[number];

export const WORKFLOW_OUTCOMES = ["pending", "succeeded", "failed"] as const;
export type WorkflowOutcome = (typeof WORKFLOW_OUTCOMES)[number];

export const WORKFLOW_COMMAND_DECISION_KINDS = [
  "accepted",
  "rejected",
] as const;
export type WorkflowCommandDecisionKind =
  (typeof WORKFLOW_COMMAND_DECISION_KINDS)[number];

export const WORKFLOW_EFFECT_DISPATCH_STATUSES = [
  "pending",
  "leased",
  "completed",
] as const;
export type WorkflowEffectDispatchStatus =
  (typeof WORKFLOW_EFFECT_DISPATCH_STATUSES)[number];

export type WorkflowActorSnapshotJson = {
  authMode: string | null;
  email: string | null;
  membershipRoles: string[];
  userId: string | null;
};

export type WorkflowProjectionJson = Record<string, unknown>;
