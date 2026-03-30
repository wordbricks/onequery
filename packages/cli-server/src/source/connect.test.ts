import { PROVIDER_TYPES } from "@onequery/db/server";
import { describe, expect, it } from "vitest";

import {
  buildCliSourceConnectGuide,
  buildCliSourceConnectResult,
} from "./connect";

describe("source connect guide", () => {
  it("reuses the canonical connect command in guide output", () => {
    const guide = buildCliSourceConnectGuide("postgres");

    expect(guide.command).toBe(
      "onequery source connect --source postgres --input '<json>'"
    );
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

  it("covers every persisted provider type with a connect guide", () => {
    expect(
      PROVIDER_TYPES.map((provider) => buildCliSourceConnectGuide(provider))
    ).toHaveLength(PROVIDER_TYPES.length);
  });

  it("documents the supabase postgres credential fallback explicitly", () => {
    const guide = buildCliSourceConnectGuide("supabase");

    expect(guide.command).toBe(
      "onequery source connect --source supabase --input '<json>'"
    );
    expect(guide.content).toContain("Set `credentials.type` to `postgres`.");
    expect(guide.providers[0]?.credentialTemplate).toMatchObject({
      sslMode: "require",
      type: "postgres",
    });
  });
});
