export const CLI_REQUEST_ID_HEADER = "x-request-id";

export type CliRequestContext = {
  get?: (key: "requestId") => unknown;
  var?: {
    requestId?: unknown;
  };
};

export function getCliRequestId(c: CliRequestContext) {
  const reqId = c.var?.requestId;
  if (typeof reqId === "string" && reqId.length > 0) {
    return reqId;
  }

  const fallbackReqId = c.get?.("requestId");
  return typeof fallbackReqId === "string" && fallbackReqId.length > 0
    ? fallbackReqId
    : "unknown";
}
