import { describe, expect, it } from "vitest";

import {
  buildCliSourceConnectGuide,
  buildCliSourceConnectResult,
} from "./connect";

describe("source connect guide", () => {
  it("renders canonical source connect guides", () => {
    expect({
      postgres: buildCliSourceConnectGuide("postgres"),
      supabase: buildCliSourceConnectGuide("supabase"),
      posthog: buildCliSourceConnectGuide("posthog"),
    }).toMatchSnapshot();
  });

  it("reuses the canonical show command in connect results", () => {
    const result = buildCliSourceConnectResult({
      displayName: null,
      id: "source_123",
      provider: "postgres",
      sourceKey: "warehouse",
      status: "active",
    });

    expect(result).toMatchSnapshot();
  });
});
