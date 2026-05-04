import type { RequestIdVariables } from "hono/request-id";

export const CLI_REQUEST_ID_HEADER = "x-request-id";

export type CliRequestContext = {
  readonly var: Readonly<RequestIdVariables>;
};
