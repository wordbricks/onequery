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
import { sourceApiActions } from "./source-api-actions";
import { pgTable } from "./table";
import { ulid } from "./ulid";
import { workflowCommands } from "./workflow-commands";

export const sourceApiActionEvents = pgTable(
  "source_api_action_events",
  {
    actionId: text("action_id")
      .notNull()
      .references(() => sourceApiActions.id, { onDelete: "cascade" }),
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
    uniqueIndex("idx_source_api_action_events_action_sequence_unique").on(
      table.actionId,
      table.sequence
    ),
    uniqueIndex("idx_source_api_action_events_commit_position_unique").on(
      table.commitPosition
    ),
    index("idx_source_api_action_events_command_sequence").on(
      table.commandId,
      table.sequence
    ),
  ]
);

export type SourceApiActionEvent = typeof sourceApiActionEvents.$inferSelect;
export type NewSourceApiActionEvent = typeof sourceApiActionEvents.$inferInsert;
