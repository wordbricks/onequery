import {
  bigserial,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { bytea } from "./bytea";
import { pgTable } from "./table";
import { ulid } from "./ulid";
import { workflowCommands } from "./workflow-commands";

export const queryActionEvents = pgTable(
  "query_action_events",
  {
    // Comment: the event log is authoritative and must survive action-row
    // repair, so `action_id` does not cascade through the fold cache table.
    actionId: text("action_id").notNull(),
    commandId: text("command_id")
      .notNull()
      .references(() => workflowCommands.id, { onDelete: "cascade" }),
    commitPosition: bigserial("commit_position", { mode: "bigint" }).notNull(),
    eventType: text("event_type").notNull(),
    id: text("id").primaryKey().$defaultFn(ulid),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payloadBytes: bytea("payload_bytes").notNull(),
    sequence: integer("sequence").notNull(),
  },
  (table) => [
    uniqueIndex("idx_query_action_events_action_sequence_unique").on(
      table.actionId,
      table.sequence
    ),
    uniqueIndex("idx_query_action_events_commit_position_unique").on(
      table.commitPosition
    ),
    index("idx_query_action_events_command_sequence").on(
      table.commandId,
      table.sequence
    ),
  ]
);

export type QueryActionEvent = typeof queryActionEvents.$inferSelect;
export type NewQueryActionEvent = typeof queryActionEvents.$inferInsert;
