import { describe, expect, it } from "vitest";

import {
  buildCliSourceListResult,
  buildCliSourceSummary,
  createCliSourceKey,
} from "./model";

describe("source model", () => {
  it("sorts and projects source summaries from loaded records", () => {
    const sources: Parameters<typeof buildCliSourceListResult>[0] = [
      {
        displayName: null,
        id: "source-1",
        provider: "postgres",
        sourceKey: "warehouse",
        status: "active",
      },
      {
        displayName: null,
        id: "source-2",
        provider: "linear",
        sourceKey: "team_linear",
        status: "active",
      },
      {
        displayName: null,
        id: "source-3",
        provider: "postgres",
        sourceKey: "broken_warehouse",
        status: "error",
      },
    ];

    expect(buildCliSourceListResult(sources)).toEqual({
      sources: [
        {
          displayName: null,
          name: "broken_warehouse",
          provider: "postgres",
          queryable: false,
          status: "error",
        },
        {
          displayName: null,
          name: "team_linear",
          provider: "linear",
          queryable: false,
          status: "active",
        },
        {
          displayName: null,
          name: "warehouse",
          provider: "postgres",
          queryable: true,
          status: "active",
        },
      ],
    });
  });

  it("projects a loaded source into the CLI summary response", () => {
    const source = {
      credentialsEncrypted: "enc",
      credentialsIv: "iv",
      displayName: null,
      id: "source-1",
      name: "warehouse",
      organizationId: "org-1",
      provider: "postgres" as const,
      sourceKey: "warehouse",
      status: "active" as const,
    };

    expect(buildCliSourceSummary(source)).toEqual({
      displayName: null,
      name: "warehouse",
      provider: "postgres",
      queryable: true,
      status: "active",
    });
  });

  it("treats supabase sources as queryable postgres-family databases", () => {
    const source = {
      credentialsEncrypted: "enc",
      credentialsIv: "iv",
      displayName: "Analytics",
      id: "source-2",
      name: "supabase_prod",
      organizationId: "org-1",
      provider: "supabase" as const,
      sourceKey: "supabase_prod",
      status: "active" as const,
    };

    expect(buildCliSourceSummary(source)).toEqual({
      displayName: "Analytics",
      name: "supabase_prod",
      provider: "supabase",
      queryable: true,
      status: "active",
    });
  });

  it("rejects traversal-style source keys when normalizing db rows", () => {
    expect(createCliSourceKey(" .. ")).toBeNull();
  });
});
