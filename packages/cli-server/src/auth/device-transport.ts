import { stringToInt } from "@onequery/codecs/number";
import { z } from "zod";

import { sanitizeCliRemoteText } from "../transport/sanitization";

const BetterAuthDeviceCodeResponseSchema = z
  .object({
    device_code: z.string().min(1),
    expires_in: z.number().int().positive().optional(),
    interval: z.number().int().positive().optional(),
    user_code: z.string().min(1),
    // Comment: the CLI server rebuilds verification links from the configured
    // public origin, so upstream Better Auth payloads do not need to echo the
    // browser-facing
    // URLs back to the client for this flow to stay valid.
    verification_uri: z.url().optional(),
    verification_uri_complete: z.url().optional(),
  })
  .meta({ id: "BetterAuthDeviceCodeResponse" });

const BetterAuthDeviceTokenSuccessResponseSchema = z
  .object({
    access_token: z.string().min(1),
  })
  .meta({ id: "BetterAuthDeviceTokenSuccessResponse" });

const BetterAuthDeviceTokenErrorResponseSchema = z
  .object({
    error: z.string().min(1),
    error_description: z.string().min(1).optional(),
  })
  .meta({ id: "BetterAuthDeviceTokenErrorResponse" });

const BetterAuthErrorPayloadSchema = z
  .looseObject({
    error_description: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      value.error_description !== undefined || value.message !== undefined
  )
  .meta({ id: "BetterAuthErrorPayload" });

const BetterAuthErrorContextSchema = z
  .looseObject({
    body: BetterAuthErrorPayloadSchema.optional(),
    status: z.number().int().optional(),
  })
  .meta({ id: "BetterAuthErrorContext" });

type BetterAuthDeviceTokenErrorResponse = z.infer<
  typeof BetterAuthDeviceTokenErrorResponseSchema
>;

export function createAuthProxyRequest(
  request: Request,
  targetPath: string,
  payload: unknown
) {
  const url = new URL(request.url);
  url.pathname = targetPath;

  const headers = new Headers(request.headers);
  // Comment: CLI device-auth proxy calls mint or exchange credentials, so they
  // must not inherit unrelated browser cookies or upstream bearer tokens.
  headers.delete("authorization");
  headers.delete("cookie");
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  return new Request(url, {
    body: JSON.stringify(payload),
    headers,
    method: request.method,
  });
}

export function createBearerHeaders(request: Request, accessToken: string) {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.set("authorization", `Bearer ${accessToken}`);
  return headers;
}

export async function readBetterAuthDeviceCodeResponse(response: Response) {
  return BetterAuthDeviceCodeResponseSchema.parse(await response.json());
}

export async function readBetterAuthDeviceTokenSuccessResponse(
  response: Response
) {
  return BetterAuthDeviceTokenSuccessResponseSchema.parse(
    await response.json()
  );
}

export async function readBetterAuthDeviceTokenErrorResponse(
  response: Response
) {
  return BetterAuthDeviceTokenErrorResponseSchema.parse(await response.json());
}

export function readBetterAuthErrorDetail(value: unknown): string | null {
  const payload = BetterAuthErrorPayloadSchema.safeParse(value);
  if (payload.success) {
    return payload.data.error_description ?? payload.data.message ?? null;
  }

  const context = BetterAuthErrorContextSchema.safeParse(value);
  if (context.success) {
    return readBetterAuthErrorDetail(context.data.body);
  }

  return null;
}

export function readBetterAuthErrorStatus(value: unknown): number | null {
  const context = BetterAuthErrorContextSchema.safeParse(value);
  return context.success ? (context.data.status ?? null) : null;
}

export function toCliDeviceAuthProblemDetail(
  payload: BetterAuthDeviceTokenErrorResponse
) {
  // Comment: Better Auth error strings are untrusted remote input, so sanitize
  // them before they become CLI-facing problem details.
  return sanitizeCliRemoteText(payload.error_description ?? payload.error);
}

export function parseRetryAfterMs(response: Response) {
  const rawValue = response.headers.get("x-retry-after");
  if (!rawValue) {
    return;
  }

  const seconds = stringToInt.safeDecode(rawValue.trim());
  if (!seconds.success || seconds.data <= 0) {
    return;
  }

  return seconds.data * 1000;
}
