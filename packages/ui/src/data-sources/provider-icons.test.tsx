import { listPublicSourceProviders } from "@onequery/db/source-providers";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProviderIcons, getProviderIcon } from "./provider-icons";

type ProviderIconTestProps = {
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
  title?: string;
};

function renderProviderIcon(
  provider: string,
  props: ProviderIconTestProps = {}
): string {
  const Icon = getProviderIcon(provider);
  return renderToStaticMarkup(<Icon {...props} />);
}

describe("shared provider icon accessibility", () => {
  it("has an integration icon for every public source provider", () => {
    for (const provider of listPublicSourceProviders()) {
      expect(ProviderIcons).toHaveProperty(provider.id);
    }
  });

  it("treats simple-icons provider icons as decorative by default", () => {
    const markup = renderProviderIcon("github");

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="img"');
    expect(markup).not.toContain("<title>");
  });

  it("exposes simple-icons provider icons when the caller supplies a label", () => {
    const markup = renderProviderIcon("github", {
      "aria-label": "GitHub provider",
    });

    expect(markup).toContain('aria-label="GitHub provider"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain("<title>GitHub provider</title>");
    expect(markup).not.toContain('aria-hidden="true"');
  });

  it("uses the same policy for local provider SVGs", () => {
    const decorativeMarkup = renderProviderIcon("cloudflare_d1");
    const accessibleMarkup = renderProviderIcon("cloudflare_d1", {
      title: "Cloudflare D1 provider",
    });

    expect(decorativeMarkup).toContain('aria-hidden="true"');
    expect(decorativeMarkup).not.toContain("<title>");
    expect(accessibleMarkup).toContain('aria-label="Cloudflare D1 provider"');
    expect(accessibleMarkup).toContain('role="img"');
    expect(accessibleMarkup).toContain("<title>Cloudflare D1 provider</title>");
  });

  it("renders Google Search Console with the current multicolor brand mark", () => {
    const markup = renderProviderIcon("google_search_console", {
      title: "Google Search Console provider",
    });

    expect(markup).toContain('viewBox="0 0 999.9841309 1000"');
    expect(markup).toContain('fill="#4285F4"');
    expect(markup).toContain('fill="#34A853"');
    expect(markup).toContain('fill="#EA4335"');
    expect(markup).toContain("<title>Google Search Console provider</title>");
  });

  it("renders SendGrid with the current multicolor brand mark", () => {
    const markup = renderProviderIcon("sendgrid", {
      title: "SendGrid provider",
    });

    expect(markup).toContain('viewBox="0 0 512 512"');
    expect(markup).toContain('fill="#9DD6E3"');
    expect(markup).toContain('fill="#00A9D1"');
    expect(markup).toContain('fill="#3F72AB"');
    expect(markup).toContain("<title>SendGrid provider</title>");
  });

  it("renders Granola with the current app icon colors", () => {
    const markup = renderProviderIcon("granola", {
      title: "Granola provider",
    });

    expect(markup).toContain('viewBox="0 0 550 550"');
    expect(markup).toContain('fill="#B2C248"');
    expect(markup).toContain('stroke="#1E1E1E"');
    expect(markup).toContain("<title>Granola provider</title>");
  });

  it("renders AWS Athena Connector as a monochrome icon", () => {
    const markup = renderProviderIcon("aws_athena_connector");

    expect(markup).toContain('fill="currentColor"');
    expect(markup).not.toContain("<linearGradient");
    expect(markup).not.toContain("<rect");
  });

  it("uses the default provider label when the caller explicitly exposes the icon", () => {
    const markup = renderProviderIcon("cloudflare_d1", {
      "aria-hidden": false,
    });

    expect(markup).toContain('aria-label="Cloudflare D1"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain("<title>Cloudflare D1</title>");
  });

  it("keeps unknown provider icons decorative by default", () => {
    const markup = renderProviderIcon("not_registered");

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="img"');
  });
});
