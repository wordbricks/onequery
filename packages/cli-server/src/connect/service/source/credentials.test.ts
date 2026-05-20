import { describe, expect, it } from "vitest";

import { parseConnectSourceCredentials } from "./credentials";

describe("parseConnectSourceCredentials", () => {
  it("injects the registry credential type and applies postgres defaults", () => {
    const result = parseConnectSourceCredentials("postgres", {
      database: "app",
      host: "localhost",
      password: "secret",
      username: "user",
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual({
      provider: "postgres",
      credentials: {
        type: "postgres",
        database: "app",
        host: "localhost",
        password: "secret",
        port: 5432,
        sslMode: "prefer",
        username: "user",
      },
    });
  });

  it("maps supabase to postgres credentials without requiring clients to send type", () => {
    const result = parseConnectSourceCredentials("supabase", {
      database: "postgres",
      host: "aws-0-us-east-1.pooler.supabase.com",
      password: "secret",
      username: "postgres.project-ref",
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      provider: "supabase",
      credentials: {
        type: "postgres",
        port: 5432,
        sslMode: "prefer",
      },
    });
  });

  it("preserves explicit athena query overrides from JSON credentials", () => {
    const result = parseConnectSourceCredentials("aws_athena_connector", {
      connectorId: "athena-connector",
      database: "analytics",
      maxRows: 500,
      timeoutMs: 15_000,
      workgroup: "primary",
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual({
      provider: "aws_athena_connector",
      credentials: {
        type: "aws_athena_connector",
        connectorId: "athena-connector",
        database: "analytics",
        maxRows: 500,
        timeoutMs: 15_000,
        workgroup: "primary",
      },
    });
  });

  it("infers BigQuery service-account auth mode from guide-shaped credentials", () => {
    const result = parseConnectSourceCredentials("bigquery", {
      projectId: "analytics-project",
      serviceAccount: {
        projectId: "analytics-project",
        clientEmail: "onequery@analytics-project.iam.gserviceaccount.com",
        privateKey:
          "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n",
      },
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.credentials).toMatchObject({
      type: "bigquery",
      authType: "service_account",
      projectId: "analytics-project",
      serviceAccount: {
        projectId: "analytics-project",
        clientEmail: "onequery@analytics-project.iam.gserviceaccount.com",
      },
    });
  });

  it("injects the Cloudflare D1 credential type", () => {
    const result = parseConnectSourceCredentials("cloudflare_d1", {
      accountId: "023e105f4ecef8ad9ca31a8372d0c353",
      apiToken: "cf_api_token",
      databaseId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual({
      provider: "cloudflare_d1",
      credentials: {
        accountId: "023e105f4ecef8ad9ca31a8372d0c353",
        apiToken: "cf_api_token",
        databaseId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        type: "cloudflare_d1",
      },
    });
  });

  it("infers Google Analytics service-account auth mode from guide-shaped credentials", () => {
    const result = parseConnectSourceCredentials("ga", {
      propertyId: "123456789",
      serviceAccount: {
        projectId: "analytics-project",
        clientEmail: "onequery@analytics-project.iam.gserviceaccount.com",
        privateKey:
          "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n",
      },
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.credentials).toMatchObject({
      type: "ga",
      authType: "service_account",
      propertyId: "123456789",
      serviceAccount: {
        projectId: "analytics-project",
        clientEmail: "onequery@analytics-project.iam.gserviceaccount.com",
      },
    });
  });

  it("rejects unknown provider strings before credential validation", () => {
    const result = parseConnectSourceCredentials("unknown_provider", {});

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("expected parse failure");
    }

    expect(result.error.message).toBe("unsupported source provider");
  });
});
