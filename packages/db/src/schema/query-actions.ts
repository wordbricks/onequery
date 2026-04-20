import {
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

import type { WorkflowJson, WorkflowOutcome } from "./audit-workflow";
import { organization } from "./auth";
import { pgTable } from "./table";
import { ulid } from "./ulid";

export const queryActions = pgTable(
  // Comment: the family name already ends in "_action", so the table stem drops
  // the duplicate "action" for readability while still mapping 1:1 to
  // `query_action` storage ownership.
  "query_actions",
  {
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    id: text("id").primaryKey().$defaultFn(ulid),
    lastEventId: text("last_event_id").notNull(),
    lastEventSequence: integer("last_event_sequence").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    outcome: text("outcome").$type<WorkflowOutcome>().notNull(),
    phase: text("phase").notNull(),
    queryMode: text("query_mode").notNull(),
    queryText: text("query_text").notNull(),
    sourceDescriptorJson: jsonb("source_descriptor_json").$type<WorkflowJson>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    usageRecordingStatus: text("usage_recording_status").notNull(),
    validatedQuery: text("validated_query"),
  },
  (table) => [
    index("idx_query_actions_org_started").on(
      table.organizationId,
      table.startedAt
    ),
    check(
      "query_actions_completed_at_outcome_check",
      sql`((${table.outcome} = 'pending' and ${table.completedAt} is null) or (${table.outcome} <> 'pending' and ${table.completedAt} is not null))`
    ),
    check(
      "query_actions_completed_phase_outcome_check",
      sql`((${table.outcome} = 'pending' and ${table.phase} <> 'completed') or (${table.outcome} <> 'pending' and ${table.phase} = 'completed'))`
    ),
    check(
      "query_actions_failure_code_outcome_check",
      sql`((${table.outcome} = 'failed' and ${table.failureCode} is not null) or (${table.outcome} <> 'failed' and ${table.failureCode} is null))`
    ),
    check(
      "query_actions_last_event_sequence_positive_check",
      sql`${table.lastEventSequence} > 0`
    ),
  ]
);

export type QueryAction = typeof queryActions.$inferSelect;
export type NewQueryAction = typeof queryActions.$inferInsert;
