import { z } from "zod";

import { organizationLocatorSchema } from "./query-organization";

const providerRequestEnvelopeSchema = z.record(z.string(), z.unknown());

export function createProviderQuerySchema<TMethodSchema extends z.ZodType>(
  methodSchema: TMethodSchema
) {
  return organizationLocatorSchema.extend({
    method: methodSchema,
    request: providerRequestEnvelopeSchema,
  });
}

export function parseProviderRequest<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  error: string
): { ok: true; data: z.output<TSchema> } | { ok: false; error: string } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { error, ok: false };
  }

  return { data: parsed.data, ok: true };
}
