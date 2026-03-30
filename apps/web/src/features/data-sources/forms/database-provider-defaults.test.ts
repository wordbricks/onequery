import { describe, expect, it } from "vitest";

import {
  getDatabaseProviderDefaults,
  isDatabaseProvider,
} from "@/features/data-sources/forms/database-provider-defaults";

describe("getDatabaseProviderDefaults", () => {
  it("returns the expected supabase defaults", () => {
    expect(getDatabaseProviderDefaults("supabase")).toEqual({
      connectionStringFormat:
        "postgresql://postgres.[project-ref]:password@db.[project-ref].supabase.co:5432/postgres",
      connectionStringPlaceholder:
        "postgresql://postgres.[project-ref]:password@db.[project-ref].supabase.co:5432/postgres",
      databasePlaceholder: "postgres",
      defaultDatabase: "postgres",
      defaultPort: 5432,
      defaultSslMode: "require",
      fallbackHost: "localhost",
      hostPlaceholder: "db.your-project-ref.supabase.co",
      invalidConnectionStringFormat:
        "postgres://user:password@host:port/database",
      isPostgresFamily: true,
      namePlaceholder: "My Supabase",
      supportedProtocols: ["postgres", "postgresql"],
      usernamePlaceholder: "postgres.your-project-ref",
    });
  });

  it("distinguishes database providers from other provider ids", () => {
    expect(isDatabaseProvider("postgres")).toBe(true);
    expect(isDatabaseProvider("supabase")).toBe(true);
    expect(isDatabaseProvider("mysql")).toBe(true);
    expect(isDatabaseProvider("github")).toBe(false);
  });
});
