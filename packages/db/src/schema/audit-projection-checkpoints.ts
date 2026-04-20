import { bigint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import type { WorkflowFamily } from "./audit-workflow";
import { pgTable } from "./table";

export const auditProjectionCheckpoints = pgTable(
  "audit_projection_checkpoints",
  {
    family: text("family").$type<WorkflowFamily>().notNull(),
    lastCommitPosition: bigint("last_commit_position", { mode: "number" })
      .notNull()
      .default(0),
    projectionName: text("projection_name").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_audit_projection_checkpoints_projection_family_unique").on(
      table.projectionName,
      table.family
    ),
  ]
);

export type AuditProjectionCheckpoint =
  typeof auditProjectionCheckpoints.$inferSelect;
export type NewAuditProjectionCheckpoint =
  typeof auditProjectionCheckpoints.$inferInsert;
