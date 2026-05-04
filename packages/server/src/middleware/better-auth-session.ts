import { createMiddleware } from "hono/factory";
import { z } from "zod";

import type { StorageVariables } from "../storage";

const AuthUserSchema = z.object({
  email: z.string(),
  id: z.string(),
  image: z.string().nullable().optional(),
  name: z.string(),
});

const AuthSessionSchema = z.object({
  activeOrganizationId: z.string().nullable().optional(),
  expiresAt: z.date(),
  id: z.string(),
  token: z.string(),
  userId: z.string(),
});

interface BetterAuthSessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null | undefined;
}

export interface BetterAuthSessionData {
  user: BetterAuthSessionUser;
  session: {
    id: string;
    expiresAt: Date;
    token: string;
    userId: string;
    activeOrganizationId: string | null;
  };
}

export interface BetterAuthSessionVariables extends StorageVariables {
  session: BetterAuthSessionData | null;
}

async function readBetterAuthSessionData(input: {
  auth: StorageVariables["storage"]["auth"];
  headers: Headers;
}): Promise<BetterAuthSessionData | null> {
  try {
    const authSession = await input.auth.api.getSession({
      headers: input.headers,
    });

    if (!authSession?.user || !authSession?.session) {
      return null;
    }

    const userResult = AuthUserSchema.safeParse(authSession.user);
    const sessionResult = AuthSessionSchema.safeParse(authSession.session);

    if (!userResult.success || !sessionResult.success) {
      return null;
    }

    return {
      session: {
        id: sessionResult.data.id,
        expiresAt: sessionResult.data.expiresAt,
        token: sessionResult.data.token,
        userId: sessionResult.data.userId,
        activeOrganizationId: sessionResult.data.activeOrganizationId ?? null,
      },
      user: {
        id: userResult.data.id,
        name: userResult.data.name,
        email: userResult.data.email,
        image: userResult.data.image,
      },
    };
  } catch {
    // Comment: session reads are best-effort here so malformed cookies or auth
    // backend hiccups degrade to anonymous access instead of failing the request.
    return null;
  }
}

/**
 * Better Auth session resolver that attaches normalized auth session data to context.
 * Does not block requests - just makes session data accessible via c.get('session').
 */
export function betterAuthSessionMiddleware() {
  return createMiddleware<{
    Variables: BetterAuthSessionVariables;
  }>(async (c, next) => {
    c.set(
      "session",
      await readBetterAuthSessionData({
        auth: c.var.storage.auth,
        headers: c.req.raw.headers,
      })
    );

    await next();
  });
}
