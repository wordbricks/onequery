import {
  bigserial,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { WorkflowJson } from "./audit-workflow";
import { queryActions } from "./query-actions";
import { pgTable } from "./table";
import { ulid } from "./ulid";
import { workflowCommands } from "./workflow-commands";

export const queryActionEvents = pgTable(
  "query_action_events",
  {
    actionId: text("action_id")
      .notNull()
      .references(() => queryActions.id, { onDelete: "cascade" }),
    commandId: text("command_id")
      .notNull()
      .references(() => workflowCommands.id, { onDelete: "cascade" }),
    commitPosition: bigserial("commit_position", { mode: "bigint" }).notNull(),
    eventType: text("event_type").notNull(),
    id: text("id").primaryKey().$defaultFn(ulid),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payloadJson: jsonb("payload_json").$type<WorkflowJson>().notNull(),
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
