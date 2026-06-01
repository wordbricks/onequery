import { listPublicSourceProviders } from "@onequery/db/source-providers";
import { describe, expect, it } from "vitest";

import {
  DATA_SOURCE_CONNECTORS,
  getConnectorFaqs,
  getConnectorPath,
} from "./data";

function getConnector(key: string) {
  const connector = DATA_SOURCE_CONNECTORS.find(
    (candidate) => candidate.key === key
  );

  if (!connector) {
    throw new Error(`Expected connector "${key}" to exist.`);
  }

  return connector;
}

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

  it("derives unique SEO slugs for connector landing pages", () => {
    const slugs = DATA_SOURCE_CONNECTORS.map((connector) => connector.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
    expect(getConnectorPath(getConnector("postgres"))).toBe(
      "/connectors/postgresql/"
    );
    expect(getConnectorPath(getConnector("ga"))).toBe(
      "/connectors/google-analytics/"
    );
  });

  it("creates connector FAQ copy from provider metadata", () => {
    const connector = getConnector("github");
    const faqs = getConnectorFaqs(connector);

    expect(faqs).toHaveLength(3);
    expect(faqs[0]?.question).toContain("GitHub");
    expect(faqs[1]?.answer).toContain("credentials");
    expect(faqs[2]?.answer).toContain(connector.guideSteps[0]);
  });
});
