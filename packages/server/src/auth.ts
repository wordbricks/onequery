import { ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS } from "@onequery/base";
import { and, createDatabaseRuntime, createDb, eq } from "@onequery/db/server";
import type { DatabaseSchema } from "@onequery/db/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import {
  bearer,
  deviceAuthorization,
  organization,
  testUtils,
} from "better-auth/plugins";

import {
  doesOrganizationMembershipGrantPermission,
  organizationAccessControl,
  organizationPermissionChecks,
  organizationRoles,
} from "./auth/organization-permissions";
import { authorizeSelfHostSignUp } from "./auth/self-host";
import { deliverPasswordResetEmail } from "./lib/email-delivery";
import type { AuthEmailDeliveryConfig } from "./lib/email-delivery";
import type { ServerRuntimeConfig } from "./runtime";

type AuthConfig = {
  databaseUrl?: string;
  db?: DbInstance;
  schema?: DatabaseSchema;
  provider?: "pg";
  secret: string;
  baseURL?: string;
  disableRateLimit?: boolean;
  emailDelivery?: AuthEmailDeliveryConfig;
  enableTestUtils?: boolean;
};

type DbInstance = ReturnType<typeof createDb>;

// Comment: Keep this value aligned with the Rust CLI constant in
// apps/cli/crates/onequery-cli/src/transport/auth.rs.
const CLI_DEVICE_AUTH_CLIENT_ID = "onequery-cli";

// ============================================================================
// Database-Backed Session Cache Configuration
// ============================================================================
// Uses an encrypted JWE cookie cache to avoid most session reads while keeping
// the database as the canonical session store.
//
// Flow:
// 1. Cookie cache (JWE encrypted) - serves cached session reads for 15 minutes
// 2. Database - source of truth after cache expiry and for server-side session
//    lifecycle operations
//
// Trade-off: Revoked sessions may remain active until the cookie cache expires.
// The cookie cache version only invalidates cached payloads, not database
// sessions.
// ============================================================================

function resolveAuthDb(config: AuthConfig): DbInstance {
  if (config.db) {
    return config.db;
  }

  if (config.databaseUrl) {
    return createDb(config.databaseUrl);
  }

  throw new Error("createAuth requires either db or databaseUrl");
}

export function createAuth(config: AuthConfig) {
  const db = resolveAuthDb(config);
  const tables =
    config.schema ??
    (config.databaseUrl
      ? createDatabaseRuntime(config.databaseUrl).schema
      : undefined);
  const provider = config.provider ?? "pg";
  const authSchema = tables;

  if (!tables) {
    throw new Error(
      "createAuth requires a runtime schema when no databaseUrl is provided"
    );
  }

  const isHttps = config.baseURL?.startsWith("https://") ?? false;

  const trustedOrigins = [
    config.baseURL,
    "https://*.wbai.workers.dev",
    "https://*.wordbricks.ai",
    "http://*.wordbricks.ai",
    "http://localhost:*",
    "https://*.nextrows.com",
  ].filter((origin): origin is string => origin !== undefined);

  const crossSubDomainCookieDomain = config.baseURL
    ? new URL(config.baseURL).hostname
    : undefined;
  const sharedCookieDomains = ["wordbricks.ai", "nextrows.com"];
  const cookieDomain = crossSubDomainCookieDomain
    ? sharedCookieDomains.find(
        (domain) =>
          crossSubDomainCookieDomain === domain ||
          crossSubDomainCookieDomain.endsWith(`.${domain}`)
      )
    : undefined;

  return betterAuth({
    database: drizzleAdapter(db, {
      provider,
      schema: authSchema,
    }),
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins,
    // Database-backed session cache: encrypted cookie payloads avoid most
    // session reads while revocation still lives in the database.
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 15 * 60, // 15 minutes - security/performance balance (SuperAdmin consideration)
        strategy: "jwe", // Encrypted session data (hidden from client)
        version: "1", // Increment to invalidate cached session payloads on deploy
      },
      storeSessionInDatabase: true, // Keep DB for session revocation capability
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: async (data, request) => {
        await deliverPasswordResetEmail(config.emailDelivery, data, request);
      },
    },
    rateLimit: {
      customRules: {
        "/device/code": {
          window: 60,
          max: 10,
        },
        // Comment: the CLI polls every 5 seconds by default (12/min), and
        // Better Auth's device plugin already enforces RFC 8628 slow_down.
        "/device/token": false,
      },
      enabled: !config.disableRateLimit,
      storage: "database",
    },
    plugins: [
      bearer(),
      deviceAuthorization({
        validateClient: async (clientId) =>
          clientId === CLI_DEVICE_AUTH_CLIENT_ID,
        verificationUri: "/api/device",
      }),
      organization({
        ac: organizationAccessControl,
        allowUserToCreateOrganization: true,
        // Comment: Org deletion is operator-assisted only because Better Auth's
        // default endpoint hard-deletes all org-owned rows transitively.
        disableOrganizationDeletion: true,
        invitationExpiresIn: ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS,
        organizationLimit: 10,
        roles: organizationRoles,
      }),
      // Comment: Better Auth documents test-utils as test-only, so runtime auth
      // instances must opt in explicitly.
      ...(config.enableTestUtils === true ? [testUtils()] : []),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          const signupEmail = await readSignupEmailFromContext(ctx);

          if (signupEmail) {
            const authorization = await authorizeSelfHostSignUp({
              db,
              email: signupEmail,
              schema: tables,
            });

            if (!authorization.allowed) {
              return ctx.json(
                {
                  error: authorization.message,
                  signupMode: authorization.state.signupMode,
                },
                {
                  status: 403,
                }
              );
            }
          }
        }

        if (ctx.path === "/organization/list-invitations") {
          const session = await getSessionFromCtx(ctx);
          if (!session?.user) {
            return;
          }

          const organizationId =
            ctx.query?.organizationId ?? session.session.activeOrganizationId;
          if (!organizationId) {
            return;
          }

          const membership = await db.query.member.findFirst({
            columns: { role: true },
            where: and(
              eq(tables.member.userId, session.user.id),
              eq(tables.member.organizationId, organizationId)
            ),
          });

          if (!membership) {
            return;
          }

          if (
            !doesOrganizationMembershipGrantPermission({
              permission: organizationPermissionChecks.invitationCancel,
              rawRole: membership.role,
            })
          ) {
            return ctx.json(
              { error: "Forbidden: owner or admin role required" },
              { status: 403 }
            );
          }
        }
      }),
    },
    advanced: {
      crossSubDomainCookies: cookieDomain
        ? {
            enabled: true,
            domain: `.${cookieDomain}`,
          }
        : undefined,
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"],
      },
      useSecureCookies: isHttps,
    },
  });
}

export interface CreateAuthFromConfigOptions {
  db?: DbInstance;
  enableTestUtils?: boolean;
  provider?: "pg";
  schema?: DatabaseSchema;
}

export function createAuthFromConfig(
  runtime: ServerRuntimeConfig,
  input: CreateAuthFromConfigOptions = {}
) {
  console.info("[auth] Using database-backed JWE session cache (15 min TTL)");

  return createAuth({
    baseURL: runtime.auth.baseURL,
    databaseUrl: runtime.storage.connectionString,
    db: input.db,
    disableRateLimit: !runtime.rateLimit.enabled,
    emailDelivery: runtime.auth.emailDelivery,
    enableTestUtils: input.enableTestUtils,
    provider: input.provider,
    schema: input.schema,
    secret: runtime.auth.secret,
  });
}

export type Auth = ReturnType<typeof createAuth>;

async function readSignupEmailFromContext(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]
): Promise<string | null> {
  const bodyEmail = readEmailField(ctx.body);
  if (bodyEmail) {
    return bodyEmail;
  }

  if (!ctx.request) {
    return null;
  }

  try {
    const payload = await ctx.request.clone().json();
    return readEmailField(payload);
  } catch {
    return null;
  }
}

function readEmailField(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const email = (value as { email?: unknown }).email;
  if (typeof email !== "string") {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  return normalizedEmail.length > 0 ? normalizedEmail : null;
}
