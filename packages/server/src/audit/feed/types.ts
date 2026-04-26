import type {
  AuditOriginActor,
  AuditOutcome,
  AuditQueryActionEventType,
  AuditQueryActionFailureCode,
  AuditQueryActionMetrics,
  AuditQueryActionPhase,
  AuditSourceApiActionEventType,
  AuditSourceApiActionFailureCode,
  AuditSourceApiActionMetrics,
  AuditSourceApiActionPhase,
  AuditTarget,
} from "@onequery/contracts/audit";
import type {
  Database,
  WorkflowActorSnapshotJson,
  WorkflowSurface,
} from "@onequery/db/server";

import type {
  QueryActionProjectionPreview,
  SourceApiActionProjectionPreview,
} from "./schemas";

export type DatabaseExecutor =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type AuditProjectionCheckpointSnapshot = {
  queryAction: bigint | null;
  sourceApiAction: bigint | null;
};

export type AuditProjectionCheckpointPositions = {
  queryAction: bigint;
  sourceApiAction: bigint;
};

export type QueryActionProjectionRow = {
  actionName: "validate" | "execute";
  completedAt: Date | null;
  failureCode: AuditQueryActionFailureCode | null;
  family: "query_action";
  familyActionId: string;
  lastEventAt: Date;
  lastProjectedSequence: number;
  lastEventType: AuditQueryActionEventType;
  metrics: AuditQueryActionMetrics | null;
  organizationId: string;
  originActor: AuditOriginActor;
  originSurface: WorkflowSurface;
  outcome: AuditOutcome;
  phase: AuditQueryActionPhase;
  preview: QueryActionProjectionPreview;
  searchDocument: string;
  startedAt: Date;
  subtitle: string;
  target: AuditTarget;
  title: string;
};

export type SourceApiActionProjectionRow = {
  actionName: "describe" | "invoke";
  completedAt: Date | null;
  failureCode: AuditSourceApiActionFailureCode | null;
  family: "source_api_action";
  familyActionId: string;
  lastEventAt: Date;
  lastProjectedSequence: number;
  lastEventType: AuditSourceApiActionEventType;
  metrics: AuditSourceApiActionMetrics | null;
  organizationId: string;
  originActor: AuditOriginActor;
  originSurface: WorkflowSurface;
  outcome: AuditOutcome;
  phase: AuditSourceApiActionPhase;
  preview: SourceApiActionProjectionPreview;
  searchDocument: string;
  startedAt: Date;
  subtitle: string;
  target: AuditTarget;
  title: string;
};

export type QueryActionEventRecord = {
  actionId: string;
  actorSnapshotJson: WorkflowActorSnapshotJson;
  commandId: string;
  commandPayloadBytes: Buffer;
  commandType: string;
  commitPosition: bigint;
  eventId: string;
  eventType: string;
  occurredAt: Date;
  organizationId: string;
  payloadBytes: Buffer;
  sequence: number;
  surface: WorkflowSurface;
};

export type SourceApiActionEventRecord = {
  actionId: string;
  actorSnapshotJson: WorkflowActorSnapshotJson;
  commandId: string;
  commandPayloadBytes: Buffer;
  commandType: string;
  commitPosition: bigint;
  eventId: string;
  eventType: string;
  occurredAt: Date;
  organizationId: string;
  payloadBytes: Buffer;
  sequence: number;
  surface: WorkflowSurface;
};

export type AuditProjectionRow =
  | QueryActionProjectionRow
  | SourceApiActionProjectionRow;
export type QueryActionProjectionRowCore = Omit<
  QueryActionProjectionRow,
  "searchDocument" | "subtitle" | "title"
>;
export type SourceApiActionProjectionRowCore = Omit<
  SourceApiActionProjectionRow,
  "searchDocument" | "subtitle" | "title"
>;
