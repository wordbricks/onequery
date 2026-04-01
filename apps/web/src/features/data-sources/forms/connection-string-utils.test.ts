import { describe, expect, it } from "vitest";

import {
  buildConnectionStringFormat,
  buildConnectionStringPlaceholder,
  parseConnectionString,
} from "@/features/data-sources/forms/connection-string-utils";

describe("connection-string-utils", () => {
  it("uses provider-specific placeholders and format hints", () => {
    expect(buildConnectionStringPlaceholder("supabase")).toBe(
      "postgresql://postgres.[project-ref]:password@db.[project-ref].supabase.co:5432/postgres"
    );
    expect(buildConnectionStringFormat("mysql")).toBe(
      "mysql://user:password@host:port/database"
    );
  });

  it("fills the default database port for postgres-family URLs", () => {
    expect(
      parseConnectionString(
        "postgres://user:secret@db.example.com/app",
        "postgres"
      )
    ).toMatchObject({
      database: "app",
      host: "db.example.com",
      port: 5432,
      username: "user",
    });
  });

  it("normalizes postgres-family URLs independently of provider branding", () => {
    expect(
      parseConnectionString(
        "postgres://user:secret@db.example.com/app",
        "postgres"
      )
    ).toEqual(
      parseConnectionString(
        "postgres://user:secret@db.example.com/app",
        "supabase"
      )
    );
    expect(
      parseConnectionString(
        "postgres://user:secret@db.example.com/app",
        "supabase"
      )
    ).toMatchObject({
      sslMode: "prefer",
    });
  });

  it("preserves postgres-family sslmode query params from the URL", () => {
    expect(
      parseConnectionString(
        "postgresql://user:secret@db.example.com/app?sslmode=prefer",
        "supabase"
      )
    ).toMatchObject({
      database: "app",
      host: "db.example.com",
      port: 5432,
      sslMode: "prefer",
      username: "user",
    });
  });

  it("rejects unsupported protocols for the selected provider", () => {
    expect(
      parseConnectionString(
        "mysql://user:secret@db.example.com/app",
        "postgres"
      )
    ).toBeNull();
  });
});
