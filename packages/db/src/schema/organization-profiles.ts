import {
  doublePrecision,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { pgTable } from "./table";
import { ulid } from "./ulid";

export const organizationProfiles = pgTable(
  "organization_profiles",
  {
    id: text("id").primaryKey().$defaultFn(ulid),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    northStarMetric: text("north_star_metric"),
    kpis: jsonb("kpis").$type<string[]>().notNull().default([]),
    websiteUrl: text("website_url"),
    monthlyBudgetUsd: doublePrecision("monthly_budget_usd"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_org_profiles_org").on(table.organizationId),
    index("idx_org_profiles_created").on(table.createdAt),
  ]
);

export type OrganizationProfile = typeof organizationProfiles.$inferSelect;
export type NewOrganizationProfile = typeof organizationProfiles.$inferInsert;
