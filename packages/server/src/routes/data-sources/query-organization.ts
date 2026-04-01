import { eq, getDatabaseSchema } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import type { Context } from "hono";
import { z } from "zod";

import { verifyOrgAccess } from "../../lib/verify-org-access";
import type { SessionVariables } from "../../middleware/session";
import type { ServerRuntimeVariables } from "../../runtime-context";

export const organizationLocatorSchema = z
  .object({
    organizationId: z.string().min(1).optional(),
    organizationSlug: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      (value.organizationId !== undefined) !==
      (value.organizationSlug !== undefined),
    {
      message: "Provide exactly one of organizationId or organizationSlug",
      path: ["organizationId"],
    }
  );

async function resolveOrganizationId(
  db: Database,
  input: {
    organizationId?: string;
    organizationSlug?: string;
  }
): Promise<string | null> {
  const { organization } = getDatabaseSchema(db);

  if (input.organizationId) {
    return input.organizationId;
  }

  if (!input.organizationSlug) {
    return null;
  }

  const org = await db.query.organization.findFirst({
    columns: { id: true },
    where: eq(organization.slug, input.organizationSlug),
  });

  return org?.id ?? null;
}

export async function resolveAccessibleOrganizationId(
  c: Context<{ Variables: ServerRuntimeVariables & SessionVariables }>,
  db: Database,
  input: {
    organizationId?: string;
    organizationSlug?: string;
  }
): Promise<
  { ok: true; organizationId: string } | { ok: false; response: Response }
> {
  const session = c.get("session");
  if (!session?.user) {
    return {
      ok: false,
      response: c.json({ error: "Unauthorized" }, 401),
    };
  }

  const organizationId = await resolveOrganizationId(db, input);
  if (!organizationId) {
    return {
      ok: false,
      response: c.json({ error: "Organization not found" }, 404),
    };
  }

  const hasAccess = await verifyOrgAccess(db, session.user.id, organizationId);
  if (!hasAccess) {
    return {
      ok: false,
      response: c.json(
        { error: "Forbidden: Not a member of this organization" },
        403
      ),
    };
  }

  return { ok: true, organizationId };
}
