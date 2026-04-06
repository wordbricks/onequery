import { createCliConnectRoute } from "./connect/hono-connect";

export { createDeviceAuthorizationBrowserRoute } from "./auth/device-browser";
export type { CreateCliAppOptions } from "./app";
export { getCliOpenApiDocument } from "./route";

// Comment: package consumers now get the Connect RPC transport by default from
// the package root. The legacy OpenAPI route remains available via `./route`
// until the remaining migration work deletes it outright.
export const createCliRoute = createCliConnectRoute;
