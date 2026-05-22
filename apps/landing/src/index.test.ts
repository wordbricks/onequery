import { describe, expect, it } from "vitest";

import {
  AGENT_DISCOVERY_LINK_HEADER,
  buildApiCatalogLinkset,
  createApiCatalogResponse,
} from "./server/api-catalog";

describe("landing discovery resources", () => {
  it("serves the API catalog well-known resource", async () => {
    const response = createApiCatalogResponse(
      new Request("https://onequery.dev/.well-known/api-catalog")
    );
    const body = (await response.json()) as {
      linkset: ReadonlyArray<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
    );
    expect(response.headers.get("Link")).toBe(AGENT_DISCOVERY_LINK_HEADER);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(body.linkset).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "api-catalog": [
            {
              href: "https://onequery.dev/.well-known/api-catalog",
              type: "application/linkset+json",
            },
          ],
          anchor: "https://onequery.dev/",
        }),
        expect.objectContaining({
          anchor: "https://onequery.dev/.well-known/api-catalog",
          item: [
            {
              href: "https://onequery.dev/api/product-updates/",
              title: "Landing product updates API",
            },
            {
              href: "https://onequery.dev/api/contact/",
              title: "Landing contact API",
            },
          ],
        }),
      ])
    );
  });

  it("omits a response body for HEAD API catalog requests", async () => {
    const response = createApiCatalogResponse(
      new Request("https://onequery.dev/.well-known/api-catalog", {
        method: "HEAD",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("builds API catalog URLs from the request origin", () => {
    expect(buildApiCatalogLinkset("https://preview.onequery.dev")).toEqual(
      expect.objectContaining({
        linkset: expect.arrayContaining([
          expect.objectContaining({
            anchor: "https://preview.onequery.dev/.well-known/api-catalog",
            item: [
              {
                href: "https://preview.onequery.dev/api/product-updates/",
                title: "Landing product updates API",
              },
              {
                href: "https://preview.onequery.dev/api/contact/",
                title: "Landing contact API",
              },
            ],
          }),
        ]),
      })
    );
  });
});
