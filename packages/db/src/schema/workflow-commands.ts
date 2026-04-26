import {
  check,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

import type {
  WorkflowActorSnapshotJson,
  WorkflowCommandDecisionKind,
  WorkflowFamily,
  WorkflowSurface,
} from "./audit-workflow";
import { organization } from "./auth";
import { bytea } from "./bytea";
import { pgTable } from "./table";
import { ulid } from "./ulid";

export const workflowCommands = pgTable(
  "workflow_commands",
  {
    actionId: text("action_id"),
    actorSnapshotJson: jsonb("actor_snapshot_json")
      .$type<WorkflowActorSnapshotJson>()
      .notNull(),
    causedByEventId: text("caused_by_event_id"),
    commandInvocationId: text("command_invocation_id").notNull(),
    commandPayloadBytes: bytea("command_payload_bytes").notNull(),
    commandType: text("command_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    decisionKind: text("decision_kind")
      .$type<WorkflowCommandDecisionKind>()
      .notNull(),
    family: text("family").$type<WorkflowFamily>().notNull(),
    id: text("id").primaryKey().$defaultFn(ulid),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    rejectCode: text("reject_code"),
    rejectDetail: text("reject_detail"),
    requestId: text("request_id").notNull(),
    surface: text("surface").$type<WorkflowSurface>().notNull(),
  },
  (table) => [
    uniqueIndex("idx_workflow_commands_family_invocation_unique").on(
      table.family,
      table.commandInvocationId
    ),
    index("idx_workflow_commands_action_created").on(
      table.family,
      table.actionId,
      table.createdAt
    ),
    index("idx_workflow_commands_org_created").on(
      table.organizationId,
      table.createdAt
    ),
    check(
      "workflow_commands_decision_reject_alignment_check",
      sql`((${table.decisionKind} = 'rejected' and ${table.rejectCode} is not null) or (${table.decisionKind} = 'accepted' and ${table.rejectCode} is null))`
    ),
    check(
      "workflow_commands_accepted_action_id_check",
      sql`(${table.decisionKind} = 'rejected' or ${table.actionId} is not null)`
    ),
  ]
);

export type WorkflowCommand = typeof workflowCommands.$inferSelect;
export type NewWorkflowCommand = typeof workflowCommands.$inferInsert;
