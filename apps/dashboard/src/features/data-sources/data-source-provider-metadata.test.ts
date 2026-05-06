import { describe, expect, it } from "vitest";

import {
  CONNECTABLE_DATA_SOURCE_PROVIDERS,
  DEFAULT_CONNECTABLE_PROVIDER,
  getDataSourceProviderLabel,
  isProviderType,
  isTestableDataSourceProvider,
} from "@/features/data-sources/data-source-provider-metadata";

describe("data-source-provider-metadata", () => {
  it("keeps the connectable provider order stable for picker defaults", () => {
    expect(DEFAULT_CONNECTABLE_PROVIDER).toBe("postgres");
    expect(CONNECTABLE_DATA_SOURCE_PROVIDERS.at(0)).toBe("postgres");
    expect(CONNECTABLE_DATA_SOURCE_PROVIDERS.at(-1)).toBe("github");
  });

  it("reuses the same provider labels across connected and available cards", () => {
    expect(getDataSourceProviderLabel("postgres")).toBe("PostgreSQL");
    expect(getDataSourceProviderLabel("linear")).toBe("Linear");
  });

  it("distinguishes connectable and testable providers", () => {
    expect(isProviderType("github")).toBe(true);
    expect(isProviderType("cloudflare_workers_observability")).toBe(true);
    expect(isProviderType("linear")).toBe(false);
    expect(isTestableDataSourceProvider("posthog")).toBe(true);
    expect(
      isTestableDataSourceProvider("cloudflare_workers_observability")
    ).toBe(false);
    expect(isTestableDataSourceProvider("github")).toBe(false);
  });
});
