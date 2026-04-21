import {
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

import type {
  WorkflowEffectDispatchStatus,
  WorkflowFamily,
  WorkflowJson,
} from "./audit-workflow";
import { pgTable } from "./table";
import { ulid } from "./ulid";

export const workflowEffectDispatches = pgTable(
  "workflow_effect_dispatches",
  {
    actionId: text("action_id").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectKey: text("effect_key").notNull(),
    effectType: text("effect_type").notNull(),
    family: text("family").$type<WorkflowFamily>().notNull(),
    id: text("id").primaryKey().$defaultFn(ulid),
    lastErrorCode: text("last_error_code"),
    lastErrorDetail: text("last_error_detail"),
    leasedUntil: timestamp("leased_until", { withTimezone: true }),
    originEventId: text("origin_event_id").notNull(),
    payloadJson: jsonb("payload_json").$type<WorkflowJson>().notNull(),
    status: text("status")
      .$type<WorkflowEffectDispatchStatus>()
      .notNull()
      .default("pending"),
  },
  (table) => [
    uniqueIndex("idx_workflow_effect_dispatches_effect_key_unique").on(
      table.effectKey
    ),
    index("idx_workflow_effect_dispatches_status_available").on(
      table.status,
      table.availableAt
    ),
    index("idx_workflow_effect_dispatches_family_action_created").on(
      table.family,
      table.actionId,
      table.createdAt
    ),
    check(
      "workflow_effect_dispatches_completion_status_check",
      sql`((${table.status} = 'completed' and ${table.completedAt} is not null) or (${table.status} <> 'completed' and ${table.completedAt} is null))`
    ),
  ]
);

export type WorkflowEffectDispatch =
  typeof workflowEffectDispatches.$inferSelect;
export type NewWorkflowEffectDispatch =
  typeof workflowEffectDispatches.$inferInsert;
