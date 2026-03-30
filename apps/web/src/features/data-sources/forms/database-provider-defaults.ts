import type { ProviderType } from "@/features/data-sources/data-source-provider-metadata";

const LOCALHOST_DATABASE_HOST = "localhost";
const POSTGRES_CONNECTION_FORMAT =
  "postgres://user:password@host:port/database";
const SUPABASE_CONNECTION_PLACEHOLDER =
  "postgresql://postgres.[project-ref]:password@db.[project-ref].supabase.co:5432/postgres";
const MYSQL_CONNECTION_FORMAT = "mysql://user:password@host:port/database";

export type DatabaseProviderType = Extract<
  ProviderType,
  "postgres" | "supabase" | "mysql"
>;

type DatabaseProviderDefaults = {
  connectionStringFormat: string;
  connectionStringPlaceholder: string;
  databasePlaceholder: string;
  defaultDatabase: string;
  defaultPort: number;
  defaultSslMode: "prefer" | "require";
  fallbackHost: string;
  hostPlaceholder: string;
  invalidConnectionStringFormat: string;
  isPostgresFamily: boolean;
  namePlaceholder: string;
  supportedProtocols: readonly string[];
  usernamePlaceholder: string;
};

const DATABASE_PROVIDER_DEFAULTS = {
  mysql: {
    connectionStringFormat: MYSQL_CONNECTION_FORMAT,
    connectionStringPlaceholder: "mysql://user:password@host:3306/database",
    databasePlaceholder: "mydb",
    defaultDatabase: "",
    defaultPort: 3306,
    defaultSslMode: "prefer",
    fallbackHost: LOCALHOST_DATABASE_HOST,
    hostPlaceholder: LOCALHOST_DATABASE_HOST,
    invalidConnectionStringFormat: MYSQL_CONNECTION_FORMAT,
    isPostgresFamily: false,
    namePlaceholder: "My Database",
    supportedProtocols: ["mysql"],
    usernamePlaceholder: "root",
  },
  postgres: {
    connectionStringFormat: POSTGRES_CONNECTION_FORMAT,
    connectionStringPlaceholder: "postgres://user:password@host:5432/database",
    databasePlaceholder: "mydb",
    defaultDatabase: "",
    defaultPort: 5432,
    defaultSslMode: "prefer",
    fallbackHost: LOCALHOST_DATABASE_HOST,
    hostPlaceholder: LOCALHOST_DATABASE_HOST,
    invalidConnectionStringFormat: POSTGRES_CONNECTION_FORMAT,
    isPostgresFamily: true,
    namePlaceholder: "My Database",
    supportedProtocols: ["postgres", "postgresql"],
    usernamePlaceholder: "postgres",
  },
  supabase: {
    connectionStringFormat: SUPABASE_CONNECTION_PLACEHOLDER,
    connectionStringPlaceholder: SUPABASE_CONNECTION_PLACEHOLDER,
    databasePlaceholder: "postgres",
    defaultDatabase: "postgres",
    defaultPort: 5432,
    defaultSslMode: "require",
    fallbackHost: LOCALHOST_DATABASE_HOST,
    hostPlaceholder: "db.your-project-ref.supabase.co",
    invalidConnectionStringFormat: POSTGRES_CONNECTION_FORMAT,
    isPostgresFamily: true,
    namePlaceholder: "My Supabase",
    supportedProtocols: ["postgres", "postgresql"],
    usernamePlaceholder: "postgres.your-project-ref",
  },
} as const satisfies Record<DatabaseProviderType, DatabaseProviderDefaults>;

export function isDatabaseProvider(
  provider: ProviderType
): provider is DatabaseProviderType {
  return (
    provider === "postgres" || provider === "supabase" || provider === "mysql"
  );
}

export function getDatabaseProviderDefaults(
  provider: DatabaseProviderType
): DatabaseProviderDefaults {
  return DATABASE_PROVIDER_DEFAULTS[provider];
}
