import { createCliConnectRoute } from "./connect/hono-connect";

// Comment: `@onequery/cli-server/route` stays as a package export path, but it
// now resolves to the same Connect handler as the package root.
export const createCliRoute = createCliConnectRoute;
