import type { Context } from "hono";

export const CLI_REQUEST_ID_HEADER = "x-request-id";

export function getCliRequestId(c: Context) {
  const requestId = c.get("requestId");
  return typeof requestId === "string" && requestId.length > 0
    ? requestId
    : "unknown";
}
