import { text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { pgTable } from "./table";
import { ulid } from "./ulid";

export const userProfiles = pgTable(
  "user_profiles",
  {
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: text("id").primaryKey().$defaultFn(ulid),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("idx_user_profiles_user").on(table.userId)]
);

export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
