import { describe, expect, it } from "vitest";

import {
  buildCliSourceConnectGuide,
  buildCliSourceConnectResult,
} from "./connect";

describe("source connect guide", () => {
  it("reuses the canonical connect command in guide output", () => {
    const guide = buildCliSourceConnectGuide("postgres");

    expect(guide.content).toContain(
      "Run: `onequery source connect --source postgres --input '<json>'`"
    );
  });

  it("reuses the canonical show command in connect results", () => {
    const result = buildCliSourceConnectResult({
      displayName: null,
      id: "source_123",
      provider: "postgres",
      sourceKey: "warehouse",
      status: "active",
    });

    expect(result.nextCommand).toBe("onequery source show warehouse");
  });
});
