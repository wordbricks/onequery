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

  it("uses the PR62 PostHog host guidance in the guide output", () => {
    const guide = buildCliSourceConnectGuide("posthog");

    expect(guide.content).toContain("https://us.posthog.com");
    expect(guide.content).toContain(
      "Do not use the SDK `api_host` value such as `https://us.i.posthog.com`."
    );
    expect(guide.content).not.toContain(
      '"hostUrl": "https://us.i.posthog.com"'
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
