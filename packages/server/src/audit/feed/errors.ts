import type { WorkflowFamily } from "@onequery/db/server";

export class InvalidAuditCursorError extends Error {
  constructor() {
    super("Invalid cursor");
  }
}

export type AuditFeedProjectionPayloadEntity =
  | "query_action_command_payload"
  | "query_action_event_payload"
  | "source_api_action_command_payload"
  | "source_api_action_event_payload";

export type AuditFeedProjectionPayloadRecord = {
  actionId: string;
  commandId: string;
  eventId: string;
};

export class AuditFeedProjectionCorruptPayloadError extends Error {
  readonly actionId: string;
  override readonly cause: unknown;
  readonly commandId: string;
  readonly entity: AuditFeedProjectionPayloadEntity;
  readonly eventId: string;
  readonly family: WorkflowFamily;
  readonly payloadType: string;

  constructor(input: {
    actionId: string;
    cause: unknown;
    commandId: string;
    entity: AuditFeedProjectionPayloadEntity;
    eventId: string;
    family: WorkflowFamily;
    payloadType: string;
  }) {
    super(
      `audit feed projection payload is corrupt (${formatAuditFeedProjectionCorruptPayloadDiagnostic(input)})`,
      {
        cause: input.cause instanceof Error ? input.cause : undefined,
      }
    );
    this.name = "AuditFeedProjectionCorruptPayloadError";
    this.actionId = input.actionId;
    this.cause = input.cause;
    this.commandId = input.commandId;
    this.entity = input.entity;
    this.eventId = input.eventId;
    this.family = input.family;
    this.payloadType = input.payloadType;
  }
}

function formatAuditFeedProjectionCorruptPayloadDiagnostic(input: {
  actionId: string;
  commandId: string;
  entity: AuditFeedProjectionPayloadEntity;
  eventId: string;
  family: WorkflowFamily;
  payloadType: string;
}) {
  return [
    `family=${input.family}`,
    `entity=${input.entity}`,
    `actionId=${input.actionId}`,
    `commandId=${input.commandId}`,
    `eventId=${input.eventId}`,
    `payloadType=${input.payloadType}`,
  ].join(" ");
}
