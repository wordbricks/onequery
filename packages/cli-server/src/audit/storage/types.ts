import type { Database } from "@onequery/db/server";

import type { WorkflowCommittedEvent, WorkflowFamily } from "../kernel";

export const MAX_STORAGE_COMMIT_ATTEMPTS = 5;

export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export type WorkflowActionRepairAnchor = {
  lastEventId: string;
  lastEventSequence: number;
};

export type StoredAcceptedWorkflowDecision<
  Family extends WorkflowFamily,
  Event extends { type: string },
> = {
  actionId: string;
  commandId: string;
  events: readonly WorkflowCommittedEvent<Event>[];
  family: Family;
  kind: "accepted";
};

export type StoredRejectedWorkflowDecision<
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

export type StoredWorkflowDecisionCore<
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
