import { dateLikeToDate } from "@onequery/codecs/date";
import { eq, organization } from "@onequery/db/server";
import type { ServerStorage } from "@onequery/server/storage";
import { z } from "zod";

import type {
  CliSessionAuthMode,
  CliSessionIdentity,
} from "../domain/workflows";

const CliAuthSessionTokenSchema = z.string().trim().min(1);
const CliAuthSessionTimestampSchema = dateLikeToDate.nullish();
const CliOptionalAuthSessionTokenSchema = CliAuthSessionTokenSchema.nullable();

const CliAuthSessionSchema = z.object({
  session: z.object({
    token: CliAuthSessionTokenSchema,
    activeOrganizationId: z.string().nullable().optional(),
    createdAt: CliAuthSessionTimestampSchema,
    expiresAt: CliAuthSessionTimestampSchema,
  }),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable().optional(),
  }),
});

type ResolvedCliAuthSession = z.infer<typeof CliAuthSessionSchema>;

type CliSessionStorage = Pick<ServerStorage, "auth" | "db">;
export type ResolveCliSessionIdentityOptions = {
  includeActiveOrgSlug?: boolean;
};

async function resolveActiveOrgSlug(
  storage: CliSessionStorage,
  activeOrganizationId: string | null
): Promise<string | null> {
  if (!activeOrganizationId) {
    return null;
  }

  try {
    const [org] = await storage.db
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, activeOrganizationId))
      .limit(1);

    return org?.slug ?? activeOrganizationId;
  } catch {
    return activeOrganizationId;
  }
}

function toOptionalIsoString(
  value: ResolvedCliAuthSession["session"]["createdAt"]
): string | null {
  return value?.toISOString() ?? null;
}

async function parseCliSessionIdentity(
  storage: CliSessionStorage,
  session: unknown,
  headers: Headers,
  accessTokenOverride: string | null,
  options: ResolveCliSessionIdentityOptions = {}
): Promise<CliSessionIdentity | null> {
  const parsed = CliAuthSessionSchema.safeParse(session);

  if (!parsed.success) {
    return null;
  }

  return {
    accessToken:
      normalizeCliAccessToken(accessTokenOverride) ?? parsed.data.session.token,
    activeOrg:
      options.includeActiveOrgSlug === true
        ? await resolveActiveOrgSlug(
            storage,
            parsed.data.session.activeOrganizationId ?? null
          )
        : null,
    authMode: resolveCliSessionAuthMode(headers),
    expiresAt: toOptionalIsoString(parsed.data.session.expiresAt),
    issuedAt: toOptionalIsoString(parsed.data.session.createdAt),
    user: {
      id: parsed.data.user.id,
      email: parsed.data.user.email,
      displayName: parsed.data.user.name ?? parsed.data.user.email,
    },
  };
}

function normalizeCliAccessToken(value: string | null) {
  const parsed = CliOptionalAuthSessionTokenSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function resolveCliSessionAuthMode(headers: Headers): CliSessionAuthMode {
  const authorization = headers.get("authorization");
  if (authorization?.trim().toLowerCase().startsWith("bearer ")) {
    return "bearer_token";
  }

  // Comment: route metadata still uses `session_cookie`, but the session payload
  // contract in Part 6 calls this user-visible mode `browser_session`.
  return "browser_session";
}

export async function resolveCliSessionIdentity(
  storage: CliSessionStorage,
  headers: Headers,
  options: ResolveCliSessionIdentityOptions = {}
): Promise<CliSessionIdentity | null> {
  const session = await storage.auth.api.getSession({
    headers,
    query: {
      disableRefresh: true,
    },
  });

  return parseCliSessionIdentity(storage, session, headers, null, options);
}

export async function refreshCliSessionIdentity(
  storage: CliSessionStorage,
  headers: Headers,
  options: ResolveCliSessionIdentityOptions = {}
): Promise<CliSessionIdentity | null> {
  const session = await storage.auth.api.getSession({
    headers,
    query: {
      disableRefresh: false,
    },
    returnHeaders: true,
  });

  return parseCliSessionIdentity(
    storage,
    session.response,
    headers,
    session.headers.get("set-auth-token"),
    options
  );
}
