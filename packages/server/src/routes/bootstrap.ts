import { zValidator } from "@hono/zod-validator";
import { eq } from "@onequery/db/server";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ServerEnv } from "../env";
import { readBootstrapState } from "../lib/bootstrap-state";
import { zodProblemHook } from "../problem-details/zod-problem-hook";
import type { StorageVariables } from "../storage";

const CompleteBootstrapBodySchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  name: z.string().min(2, "Name must be at least 2 characters"),
  organizationName: z
    .string()
    .min(2, "Organization name must be at least 2 characters"),
  organizationSlug: z
    .string()
    .min(2, "Organization slug must be at least 2 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Organization slug can only contain lowercase letters, numbers, and hyphens"
    ),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const CompleteBootstrapResponseSchema = z.object({
  bootstrap: z.object({
    organizationId: z.string().min(1),
    organizationSlug: z.string().min(1),
    userId: z.string().min(1),
  }),
});

const SignUpResponseSchema = z.object({
  user: z.object({
    id: z.string().min(1),
  }),
});

const CreateOrganizationResponseSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
});

const CreateOrganizationCleanupSchema = z.object({
  id: z.string().min(1),
});

export const bootstrapRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: StorageVariables;
}>()
  .get("/", async (c) => {
    const state = await readBootstrapState(c.var.storage.db);
    const response = c.json(state, 200);
    response.headers.set("cache-control", "no-store");
    return response;
  })
  .post(
    "/complete",
    zValidator("json", CompleteBootstrapBodySchema, zodProblemHook()),
    async (c) => {
      const state = await readBootstrapState(c.var.storage.db);
      if (!state.needsBootstrap) {
        return c.json(
          {
            error:
              "Bootstrap is already complete. Sign in with an existing account.",
          },
          409
        );
      }

      const auth = c.var.storage.auth;
      const db = c.var.storage.db;
      const schema = c.var.storage.schema;
      const body = c.req.valid("json");
      let createdOrganizationId: string | null = null;
      const baseUrl = c.env.BETTER_AUTH_URL;
      const origin = c.req.header("origin") ?? baseUrl;

      const signUpResponse = await auth.handler(
        new Request(new URL("/api/auth/sign-up/email", baseUrl).toString(), {
          body: JSON.stringify({
            email: body.email.trim().toLowerCase(),
            name: body.name,
            password: body.password,
          }),
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
          },
          method: "POST",
        })
      );

      if (!signUpResponse.ok) {
        return c.json(
          {
            error: await readResponseError(
              signUpResponse,
              "Failed to create the initial operator account"
            ),
          },
          {
            status: signUpResponse.status as ContentfulStatusCode,
          }
        );
      }

      const signUpPayload = SignUpResponseSchema.safeParse(
        await signUpResponse.json()
      );
      if (!signUpPayload.success) {
        return c.json(
          {
            error: "Failed to create the initial operator account",
          },
          500
        );
      }

      const userId = signUpPayload.data.user.id;

      try {
        const createOrganizationResponse = await auth.api.createOrganization({
          asResponse: true,
          body: {
            name: body.organizationName,
            slug: body.organizationSlug,
          },
          headers: buildAuthHeaders(c.req.raw.headers, signUpResponse.headers),
        });

        if (!createOrganizationResponse.ok) {
          throw new BootstrapFlowError(
            await readResponseError(
              createOrganizationResponse,
              "Failed to create the initial organization"
            ),
            createOrganizationResponse.status
          );
        }

        const createOrganizationPayload = await createOrganizationResponse
          .json()
          .catch(() => null);
        const cleanupPayload = CreateOrganizationCleanupSchema.safeParse(
          createOrganizationPayload
        );
        if (cleanupPayload.success) {
          createdOrganizationId = cleanupPayload.data.id;
        }

        const organizationPayload = CreateOrganizationResponseSchema.safeParse(
          createOrganizationPayload
        );
        if (!organizationPayload.success) {
          throw new BootstrapFlowError(
            "Failed to create the initial organization",
            500
          );
        }

        const response = c.json(
          CompleteBootstrapResponseSchema.parse({
            bootstrap: {
              organizationId: organizationPayload.data.id,
              organizationSlug: organizationPayload.data.slug,
              userId,
            },
          }),
          201
        );

        appendSetCookies(response.headers, signUpResponse.headers);
        appendSetCookies(response.headers, createOrganizationResponse.headers);
        response.headers.set("cache-control", "no-store");
        return response;
      } catch (error) {
        const cleanupOperations: Promise<unknown>[] = [
          db.delete(schema.user).where(eq(schema.user.id, userId)),
        ];
        if (createdOrganizationId) {
          // Comment: createOrganization can commit its side effects before the
          // response body is validated here, so bootstrap cleanup must also
          // remove any partially created organization state.
          cleanupOperations.push(
            db
              .delete(schema.organization)
              .where(eq(schema.organization.id, createdOrganizationId))
          );
        }
        await Promise.allSettled(cleanupOperations);

        if (error instanceof BootstrapFlowError) {
          return c.json(
            { error: error.message },
            {
              status: error.status as ContentfulStatusCode,
            }
          );
        }

        return c.json(
          {
            error: "Failed to complete the first-run bootstrap flow",
          },
          500
        );
      }
    }
  );

class BootstrapFlowError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BootstrapFlowError";
    this.status = status;
  }
}

function buildAuthHeaders(
  requestHeaders: Headers,
  authResponseHeaders: Headers
): Headers {
  const headers = new Headers(requestHeaders);
  const cookies = getSetCookieValues(authResponseHeaders)
    .map((setCookie) => setCookie.split(";")[0]?.trim())
    .filter((value): value is string => Boolean(value));

  if (cookies.length > 0) {
    headers.set("cookie", cookies.join("; "));
  }

  return headers;
}

function appendSetCookies(target: Headers, source: Headers) {
  for (const setCookie of getSetCookieValues(source)) {
    target.append("set-cookie", setCookie);
  }
}

function getSetCookieValues(headers: Headers): string[] {
  const headersWithGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headersWithGetSetCookie.getSetCookie?.();

  if (Array.isArray(setCookies) && setCookies.length > 0) {
    return setCookies;
  }

  const singleValue = headers.get("set-cookie");
  return singleValue ? [singleValue] : [];
}

async function readResponseError(response: Response, fallback: string) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null);
    const parsed = z
      .object({
        error: z
          .union([
            z.string(),
            z.object({
              message: z.string(),
            }),
          ])
          .optional(),
        message: z.string().optional(),
      })
      .safeParse(payload);

    if (parsed.success) {
      if (typeof parsed.data.error === "string") {
        return parsed.data.error;
      }

      if (parsed.data.error?.message) {
        return parsed.data.error.message;
      }

      if (parsed.data.message) {
        return parsed.data.message;
      }
    }
  }

  const text = await response.text().catch(() => "");
  return text || fallback;
}
