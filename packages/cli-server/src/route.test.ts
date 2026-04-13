import { describe, expect, it } from "vitest";

import { createCliRoute as createCliRouteFromConnectRoute } from "./connect/route";
import { createCliRoute as createCliRouteFromRoot } from "./index";
import { createCliRoute as createCliRouteFromRouteModule } from "./route";

describe("cli route exports", () => {
  it("use the Connect route from both package entrypoints", () => {
    expect(createCliRouteFromRoot).toBe(createCliRouteFromConnectRoute);
    expect(createCliRouteFromRouteModule).toBe(createCliRouteFromConnectRoute);
  });
});
