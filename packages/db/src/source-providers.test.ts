import { describe, expect, it } from "vitest";

import { SOURCE_CONNECT_PROVIDER_GUIDES } from "./connection-guide";
import {
  GOOGLE_OAUTH_SOURCE_PROVIDER_IDS,
  SOURCE_PROVIDER_IDS,
  getGoogleOAuthSourceProviderConfig,
  listPublicSourceProviders,
  safeParseSourceProviderCredentials,
} from "./source-providers";

describe("source provider registry boundaries", () => {
  it("parses every dashboard credential example without a client-supplied type", () => {
    for (const provider of listPublicSourceProviders().filter(
      (entry) => entry.dashboardConnectable
    )) {
      const credentials = { ...provider.credentialExample };
      delete credentials.type;
      const parsed = safeParseSourceProviderCredentials({
        credentials,
        provider: provider.id,
      });

      if (!parsed.success) {
        throw new Error(
          `${provider.id}: ${JSON.stringify(parsed.error, null, 2)}`
        );
      }

      expect(parsed.data.provider).toBe(provider.id);
      expect(parsed.data.credentials.type).toBe(provider.credentialType);
    }
  });

  it("uses the provider registry as the credential discriminator authority", () => {
    const parsed = safeParseSourceProviderCredentials({
      provider: "supabase",
      credentials: {
        database: "postgres",
        host: "db.example.com",
        password: "secret",
        type: "mysql",
        username: "postgres",
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("expected credentials to parse");
    }

    expect(parsed.data.credentials).toMatchObject({
      sslMode: "require",
      type: "postgres",
    });
  });

  it("returns structured errors for unsupported providers and credentials", () => {
    const unsupported = safeParseSourceProviderCredentials({
      credentials: {},
      provider: "not_registered",
    });
    const invalid = safeParseSourceProviderCredentials({
      credentials: {},
      provider: "postgres",
    });

    expect(unsupported).toMatchObject({
      success: false,
      error: { code: "unsupported_provider" },
    });
    expect(invalid).toMatchObject({
      success: false,
      error: { code: "invalid_credentials" },
    });
  });

  it("derives every CLI connection guide from the provider registry", () => {
    expect(
      SOURCE_CONNECT_PROVIDER_GUIDES.map((guide) => guide.provider)
    ).toEqual(SOURCE_PROVIDER_IDS);
  });

  it("keeps Google OAuth scopes and credential defaults in the provider registry", () => {
    expect(GOOGLE_OAUTH_SOURCE_PROVIDER_IDS).toEqual([
      "bigquery",
      "ga",
      "youtube_analytics",
      "google_search_console",
    ]);
    expect(getGoogleOAuthSourceProviderConfig("bigquery")).toMatchObject({
      credentialDefaults: { projectId: "" },
      credentialType: "bigquery",
      label: "BigQuery",
    });
    expect(getGoogleOAuthSourceProviderConfig("postgres")).toBeNull();
  });
});
