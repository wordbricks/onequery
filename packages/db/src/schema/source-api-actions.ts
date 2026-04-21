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

export const sourceApiActions = pgTable(
  // Comment: `source_api_action` follows the same table naming rule as
  // `query_action`: drop the repeated "action" stem in the table name and keep
  // the family value explicit in shared rows.
  "source_api_actions",
  {
    attemptNumber: integer("attempt_number"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    id: text("id").primaryKey().$defaultFn(ulid),
    invokeMode: text("invoke_mode"),
    lastEventId: text("last_event_id").notNull(),
    lastEventSequence: integer("last_event_sequence").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    outcome: text("outcome").$type<WorkflowOutcome>().notNull(),
    pageProgressJson: jsonb("page_progress_json").$type<WorkflowJson>(),
    phase: text("phase").notNull(),
    preparedRequestFingerprint: text("prepared_request_fingerprint"),
    requestDescriptorJson: jsonb(
      "request_descriptor_json"
    ).$type<WorkflowJson>(),
    requestKind: text("request_kind").notNull(),
    sourceDescriptorJson: jsonb("source_descriptor_json").$type<WorkflowJson>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_source_api_actions_org_started").on(
      table.organizationId,
      table.startedAt
    ),
    check(
      "source_api_actions_completed_at_outcome_check",
      sql`((${table.outcome} = 'pending' and ${table.completedAt} is null) or (${table.outcome} <> 'pending' and ${table.completedAt} is not null))`
    ),
    check(
      "source_api_actions_completed_phase_outcome_check",
      sql`((${table.outcome} = 'pending' and ${table.phase} <> 'completed') or (${table.outcome} <> 'pending' and ${table.phase} = 'completed'))`
    ),
    check(
      "source_api_actions_failure_code_outcome_check",
      sql`((${table.outcome} = 'failed' and ${table.failureCode} is not null) or (${table.outcome} <> 'failed' and ${table.failureCode} is null))`
    ),
    check(
      "source_api_actions_last_event_sequence_positive_check",
      sql`${table.lastEventSequence} > 0`
    ),
  ]
);

export type SourceApiAction = typeof sourceApiActions.$inferSelect;
export type NewSourceApiAction = typeof sourceApiActions.$inferInsert;
