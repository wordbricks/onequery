import type { Database } from "@onequery/db/server";
import type { Result as ResultType } from "better-result";

import type { WorkflowInternalInvariantError } from "../invariant-errors";
import type {
  WorkflowCommandEnvelope,
  WorkflowCommittedEvent,
  WorkflowDecision,
  WorkflowFamily,
  WorkflowStateBase,
} from "../kernel";
import type { WorkflowStorageCorruptRowError } from "./errors";

export const MAX_STORAGE_COMMIT_ATTEMPTS = 5;

export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export type WorkflowActionRepairAnchor = {
  lastEventId: string;
  lastEventSequence: number;
};

export type WorkflowActionHistory<Event extends { type: string }> = {
  events: readonly WorkflowCommittedEvent<Event>[];
  organizationId: string;
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

export type WorkflowStoreAdapter<
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
  ) => ResultType<
    WorkflowDecision<Event, Effect, RejectCode>,
    WorkflowInternalInvariantError
  >;
  encodeCommandPayload: (payload: CommandPayload) => Buffer;
  encodeEffectPayload: (effect: Effect) => Buffer;
  family: Family;
  getCommandPayloadType: (payload: CommandPayload) => string;
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
  ) => Promise<
    ResultType<
      readonly WorkflowCommittedEvent<Event>[],
      WorkflowStorageCorruptRowError
    >
  >;
  loadHistoryByActionId: (
    db: Database,
    actionId: string
  ) => Promise<
    ResultType<
      WorkflowActionHistory<Event> | null,
      WorkflowStorageCorruptRowError
    >
  >;
  loadLatestEventPointer: (
    db: Database,
    actionId: string
  ) => Promise<WorkflowActionRepairAnchor | null>;
  loadState: (
    db: Database,
    actionId: string
  ) => Promise<ResultType<State | null, WorkflowStorageCorruptRowError>>;
  repairAction: (input: {
    actionId: string;
    organizationId: string;
    repairAnchor: WorkflowActionRepairAnchor | null;
    state: State;
    tx: DatabaseTransaction;
  }) => Promise<boolean>;
  reduce: (
    state: State | null,
    event: WorkflowCommittedEvent<Event>
  ) => ResultType<State, WorkflowInternalInvariantError>;
  updateAction: (input: {
    actionId: string;
    expectedLastEventId: string;
    expectedLastEventSequence: number;
    state: State;
    tx: DatabaseTransaction;
  }) => Promise<boolean>;
};

export type TransactionCommitOutcome<
  Family extends WorkflowFamily,
  Event extends { type: string },
  RejectCode extends string,
> =
  | StoredAcceptedWorkflowDecision<Family, Event>
  | StoredRejectedWorkflowDecision<Family, RejectCode>
  | {
      kind: "race_lost";
    };
