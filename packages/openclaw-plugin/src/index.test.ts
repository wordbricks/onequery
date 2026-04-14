import { describe, expect, it, vi } from "vitest";

import plugin from "./index";

describe("openclaw plugin entry", () => {
  it("keeps the expected plugin metadata", () => {
    expect(plugin.id).toBe("onequery");
    expect(plugin.name).toBe("OneQuery");
    expect(plugin.description).toContain("onequery-openclaw");
  });

  it("does not register custom agent tools", () => {
    const registerTool = vi.fn();

    plugin.register({ registerTool } as never);

    expect(registerTool).not.toHaveBeenCalled();
  });
});
