import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONNECTABLE_PROVIDER,
  getConnectableDataSourceOptions,
  getDataSourceProviderLabel,
  isProviderType,
  isTestableDataSourceProvider,
} from "@/features/data-sources/data-source-provider-metadata";
import type { SourceProviderCatalogProvider } from "@/queries/data-sources-queries";

const providers = [
  {
    id: "postgres",
    label: "PostgreSQL",
    publicCategory: "Databases",
    connectable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "database",
    testable: true,
    interfaces: ["query"],
    credentialType: "postgres",
    credentialExample: {},
    guideSummary: "Connect PostgreSQL.",
    guideSteps: ["Collect database credentials."],
  },
  {
    id: "linear",
    label: "Linear",
    publicCategory: "Developer workflow",
    connectable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "linear",
    testable: false,
    interfaces: ["api"],
    credentialType: "linear",
    credentialExample: {},
    guideSummary: "Connect Linear.",
    guideSteps: ["Collect an API key."],
  },
  {
    id: "cloudflare_workers_observability",
    label: "Cloudflare Workers Observability",
    publicCategory: "Observability",
    connectable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "cloudflare_workers_observability",
    testable: false,
    interfaces: ["api"],
    credentialType: "cloudflare_workers_observability",
    credentialExample: {},
    guideSummary: "Connect Cloudflare Workers Observability.",
    guideSteps: ["Collect account credentials."],
  },
] satisfies SourceProviderCatalogProvider[];

describe("data-source-provider-metadata", () => {
  it("keeps the fallback picker default stable", () => {
    expect(DEFAULT_CONNECTABLE_PROVIDER).toBe("postgres");
  });

  it("builds picker options from the server catalog", () => {
    const options = getConnectableDataSourceOptions(providers);

    expect(options.map((provider) => provider.value)).toEqual([
      "postgres",
      "linear",
      "cloudflare_workers_observability",
    ]);
  });

  it("reuses server provider labels across connected and available cards", () => {
    expect(getDataSourceProviderLabel("postgres", providers)).toBe(
      "PostgreSQL"
    );
    expect(getDataSourceProviderLabel("linear", providers)).toBe("Linear");
  });

  it("distinguishes connectable and testable providers from server metadata", () => {
    expect(isProviderType("cloudflare_workers_observability", providers)).toBe(
      true
    );
    expect(isProviderType("linear", providers)).toBe(true);
    expect(isTestableDataSourceProvider("postgres", providers)).toBe(true);
    expect(
      isTestableDataSourceProvider(
        "cloudflare_workers_observability",
        providers
      )
    ).toBe(false);
  });
});
