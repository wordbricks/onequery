import {
  integer,
  index,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { WorkflowFamily } from "./audit-workflow";
import { organization } from "./auth";
import { bytea } from "./bytea";
import { pgTable } from "./table";

export const PENDING_WORKFLOW_EFFECT_STATUSES = [
  "pending",
  "leased",
  "failed",
] as const;
export type PendingWorkflowEffectStatus =
  (typeof PENDING_WORKFLOW_EFFECT_STATUSES)[number];

export const pendingWorkflowEffects = pgTable(
  "pending_workflow_effects",
  {
    attemptCount: integer("attempt_count").notNull().default(0),
    effectId: text("effect_id").notNull(),
    effectType: text("effect_type").notNull(),
    family: text("family").$type<WorkflowFamily>().notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorDetail: text("last_error_detail"),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    payloadBytes: bytea("payload_bytes").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    scheduledByEntryId: text("scheduled_by_entry_id").notNull(),
    status: text("status").$type<PendingWorkflowEffectStatus>().notNull(),
    streamId: text("stream_id").notNull(),
    streamPosition: integer("stream_position").notNull(),
  },
  (table) => [
    uniqueIndex("idx_pending_workflow_effects_family_effect_unique").on(
      table.family,
      table.effectId
    ),
    index("idx_pending_workflow_effects_worker_scan").on(
      table.family,
      table.organizationId,
      table.status,
      table.scheduledAt
    ),
    index("idx_pending_workflow_effects_stream").on(
      table.family,
      table.streamId
    ),
  ]
);

export type PendingWorkflowEffect = typeof pendingWorkflowEffects.$inferSelect;
export type NewPendingWorkflowEffect =
  typeof pendingWorkflowEffects.$inferInsert;
