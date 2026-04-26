import {
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type {
  WorkflowFamily,
  WorkflowOutcome,
  WorkflowProjectionJson,
  WorkflowSurface,
} from "./audit-workflow";
import { organization } from "./auth";
import { pgTable } from "./table";

export const auditFeedEntries = pgTable(
  "audit_feed_entries",
  {
    actionName: text("action_name").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    family: text("family").$type<WorkflowFamily>().notNull(),
    familyActionId: text("family_action_id").notNull(),
    familyPreviewJson: jsonb(
      "family_preview_json"
    ).$type<WorkflowProjectionJson>(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
    lastProjectedSequence: integer("last_projected_sequence").notNull(),
    lastEventType: text("last_event_type").notNull(),
    metricsJson: jsonb("metrics_json").$type<WorkflowProjectionJson>(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    originActorJson: jsonb("origin_actor_json")
      .$type<WorkflowProjectionJson>()
      .notNull(),
    originSurface: text("origin_surface").$type<WorkflowSurface>().notNull(),
    outcome: text("outcome").$type<WorkflowOutcome>().notNull(),
    phase: text("phase").notNull(),
    searchDocument: text("search_document").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    subtitle: text("subtitle").notNull(),
    targetJson: jsonb("target_json").$type<WorkflowProjectionJson>().notNull(),
    title: text("title").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.family, table.familyActionId],
      name: "audit_feed_entries_family_action_pk",
    }),
    index("idx_audit_feed_entries_org_started_identity").on(
      table.organizationId,
      table.startedAt,
      table.family,
      table.familyActionId
    ),
    index("idx_audit_feed_entries_org_family_started").on(
      table.organizationId,
      table.family,
      table.startedAt
    ),
  ]
);

export type AuditFeedEntry = typeof auditFeedEntries.$inferSelect;
export type NewAuditFeedEntry = typeof auditFeedEntries.$inferInsert;
