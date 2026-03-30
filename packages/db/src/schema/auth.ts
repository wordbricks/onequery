import {
  boolean,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { pgTable } from "./table";

export const user = pgTable("user", {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  id: text("id").primaryKey(),
  image: text("image"),
  name: text("name").notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;

export const session = pgTable(
  "session",
  {
    activeOrganizationId: text("active_organization_id").references(
      () => organization.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id").primaryKey(),
    ipAddress: text("ip_address"),
    token: text("token").notNull().unique(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;

export const account = pgTable(
  "account",
  {
    // Comment: Better Auth persists provider tokens/password hashes in this
    // canonical table shape. Re-encrypting or relocating these fields would
    // require a coordinated auth/data migration outside this scoped pass.
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    accountId: text("account_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    id: text("id").primaryKey(),
    idToken: text("id_token"),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;

export const verification = pgTable(
  "verification",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    value: text("value").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;

export const organization = pgTable("organization", {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  id: text("id").primaryKey(),
  logo: text("logo"),
  metadata: text("metadata"),
  name: text("name").notNull(),
  slug: text("slug").unique(),
});

export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;

export const member = pgTable(
  "member",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ]
);

export type Member = typeof member.$inferSelect;
export type NewMember = typeof member.$inferInsert;

export const invitation = pgTable(
  "invitation",
  {
    createdAt: timestamp("created_at").notNull().defaultNow(),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id").primaryKey(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role"),
    status: text("status").notNull(),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
);

export type Invitation = typeof invitation.$inferSelect;
export type NewInvitation = typeof invitation.$inferInsert;

export const deviceCode = pgTable(
  "device_code",
  {
    clientId: text("client_id"),
    deviceCode: text("device_code").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id").primaryKey(),
    lastPolledAt: timestamp("last_polled_at"),
    pollingInterval: integer("polling_interval"),
    scope: text("scope"),
    status: text("status").notNull(),
    userCode: text("user_code").notNull(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    uniqueIndex("device_code_device_code_key").on(table.deviceCode),
    uniqueIndex("device_code_user_code_key").on(table.userCode),
    index("device_code_user_id_idx").on(table.userId),
    index("device_code_expires_at_idx").on(table.expiresAt),
  ]
);

export type DeviceCode = typeof deviceCode.$inferSelect;
export type NewDeviceCode = typeof deviceCode.$inferInsert;
