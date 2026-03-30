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
import { parseAuthEnv } from "./env";
import type { AuthEnv } from "./env";
import { createBetterAuthRateLimitStorage } from "./lib/better-auth-rate-limit-storage";
import { deliverPasswordResetEmail } from "./lib/email-delivery";
import type { AuthEmailDeliveryConfig } from "./lib/email-delivery";
import type { RuntimeRateLimitStorage } from "./lib/rate-limit-storage";

type AuthConfig = {
  databaseUrl?: string;
  db?: DbInstance;
  schema?: DatabaseSchema;
  provider?: "pg";
  secret: string;
  baseURL?: string;
  authRateLimitStorage?: ReturnType<typeof createBetterAuthRateLimitStorage>;
  disableRateLimit?: boolean;
  emailDelivery?: AuthEmailDeliveryConfig;
  enableTestUtils?: boolean;
  rateLimitStorage?: RuntimeRateLimitStorage;
};

const AUTH_CACHE_SYMBOL = Symbol.for("onequery.auth.instance-cache");

type AuthCache = Map<string, ReturnType<typeof createAuth>>;

function getAuthCache(): AuthCache {
  const globalWithCache = globalThis as typeof globalThis & {
    [AUTH_CACHE_SYMBOL]?: AuthCache;
  };

  if (!globalWithCache[AUTH_CACHE_SYMBOL]) {
    globalWithCache[AUTH_CACHE_SYMBOL] = new Map();
  }

  return globalWithCache[AUTH_CACHE_SYMBOL];
}

type DbInstance = ReturnType<typeof createDb>;

// Comment: Keep this value aligned with the Rust CLI constant in
// apps/cli/crates/onequery-cli/src/transport/auth.rs.
const CLI_DEVICE_AUTH_CLIENT_ID = "onequery-cli";

// ============================================================================
// Stateless JWE Session Configuration
// ============================================================================
// Uses encrypted cookie cache (JWE) to eliminate DB round-trips for session
// validation. Session data is encrypted and stored directly in the cookie.
//
// Flow:
// 1. Cookie cache (JWE encrypted) - instant, no I/O
// 2. Database (fallback on cache miss/expiry) - ~10-20ms with Hyperdrive
//
// Trade-off: Revoked sessions remain valid until cookie expires (15 min max).
// To invalidate all sessions immediately, increment the version number.
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
    // Stateless JWE session: encrypted cookie cache eliminates DB round-trips
    // See comment block above for architecture details
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 15 * 60, // 15 minutes - security/performance balance (SuperAdmin consideration)
        strategy: "jwe", // Encrypted session data (hidden from client)
        version: "1", // Increment to invalidate all sessions on deploy
        refreshCache: true, // Auto-refresh at 80% of maxAge (~12 min)
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
      customStorage:
        config.authRateLimitStorage ?? createBetterAuthRateLimitStorage(),
      enabled: !config.disableRateLimit,
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

export function createAuthFromEnv(env: AuthEnv) {
  const parsedConfig = parseAuthEnv(env);
  const config: AuthConfig = {
    ...parsedConfig,
    authRateLimitStorage: parsedConfig.rateLimitStorage?.auth,
  };

  const cacheKey = [
    config.databaseUrl,
    config.secret,
    config.baseURL ?? "",
    config.rateLimitStorage ? "persistent" : "memory",
    config.disableRateLimit ? "rate-limit-disabled" : "rate-limit-enabled",
    config.emailDelivery?.smtp?.host ?? "manual-link",
    config.emailDelivery?.smtp?.port ?? "no-port",
    config.emailDelivery?.smtp?.fromEmail ?? "no-from",
  ].join("|");

  const cache = getAuthCache();
  const cachedAuth = cache.get(cacheKey);
  if (cachedAuth) {
    return cachedAuth;
  }

  console.info("[auth] Using stateless JWE session cache (15 min TTL)");
  const auth = createAuth(config);
  cache.set(cacheKey, auth);

  return auth;
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
