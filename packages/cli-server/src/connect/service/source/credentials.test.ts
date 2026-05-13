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

  it("rejects unknown provider strings before credential validation", () => {
    const result = parseConnectSourceCredentials("unknown_provider", {});

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("expected parse failure");
    }

    expect(result.error.message).toBe("unsupported source provider");
  });
});
