import { describe, expect, it } from "vitest";

import { createCliConnectRoute } from "./connect/hono-connect";
import { createCliRoute as createCliRouteFromRoot } from "./index";
import { createCliRoute as createCliRouteFromRouteModule } from "./route";

describe("cli route exports", () => {
  it("use the Connect route from both package entrypoints", () => {
    expect(createCliRouteFromRoot).toBe(createCliConnectRoute);
    expect(createCliRouteFromRouteModule).toBe(createCliConnectRoute);
  });
});
