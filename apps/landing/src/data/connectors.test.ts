import { listPublicSourceProviders } from "@onequery/db/source-providers";
import { describe, expect, it } from "vitest";

import { DATA_SOURCE_CONNECTORS } from "./connectors";

describe("DATA_SOURCE_CONNECTORS", () => {
  it("is derived from every public source provider", () => {
    expect(DATA_SOURCE_CONNECTORS.map((connector) => connector.key)).toEqual(
      listPublicSourceProviders().map((provider) => provider.id)
    );
  });

  it("includes recently added source providers", () => {
    expect(DATA_SOURCE_CONNECTORS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "Productivity",
          key: "cal",
          label: "Cal.com",
        }),
        expect.objectContaining({
          category: "Productivity",
          key: "granola",
          label: "Granola",
        }),
      ])
    );
  });
});
