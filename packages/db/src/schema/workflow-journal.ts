import {
  bigserial,
  check,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

import type {
  WorkflowFamily,
  WorkflowJournalEntryKind,
} from "./audit-workflow";
import { organization } from "./auth";
import { bytea } from "./bytea";
import { pgTable } from "./table";
import { ulid } from "./ulid";

export const workflowJournal = pgTable(
  "workflow_journal",
  {
    commandInvocationId: text("command_invocation_id"),
    commitId: text("commit_id").notNull(),
    commitPosition: bigserial("commit_position", { mode: "bigint" }).notNull(),
    entryKind: text("entry_kind").$type<WorkflowJournalEntryKind>().notNull(),
    eventId: text("event_id"),
    eventType: text("event_type"),
    effectId: text("effect_id"),
    effectType: text("effect_type"),
    family: text("family").$type<WorkflowFamily>().notNull(),
    id: text("id").primaryKey().$defaultFn(ulid),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    payloadBytes: bytea("payload_bytes"),
    payloadType: text("payload_type"),
    streamId: text("stream_id").notNull(),
    streamPosition: integer("stream_position").notNull(),
  },
  (table) => [
    uniqueIndex("idx_workflow_journal_stream_position_unique").on(
      table.family,
      table.streamId,
      table.streamPosition
    ),
    uniqueIndex("idx_workflow_journal_commit_position_unique").on(
      table.commitPosition
    ),
    uniqueIndex("idx_workflow_journal_command_invocation_unique").on(
      table.family,
      table.commandInvocationId
    ),
    index("idx_workflow_journal_commit").on(table.commitId),
    index("idx_workflow_journal_stream").on(
      table.family,
      table.streamId,
      table.streamPosition
    ),
    index("idx_workflow_journal_effect").on(
      table.family,
      table.streamId,
      table.effectId
    ),
    check(
      "workflow_journal_command_invocation_check",
      sql`(${table.entryKind} = 'command' and ${table.commandInvocationId} is not null) or (${table.entryKind} <> 'command' and ${table.commandInvocationId} is null)`
    ),
  ]
);

export type WorkflowJournal = typeof workflowJournal.$inferSelect;
export type NewWorkflowJournal = typeof workflowJournal.$inferInsert;
