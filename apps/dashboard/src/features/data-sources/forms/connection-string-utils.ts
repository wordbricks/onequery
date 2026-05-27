import type { DatabaseFormData } from "@/features/data-sources/forms/database-form-schema";
import { getDatabaseProviderDefaults } from "@/features/data-sources/forms/database-provider-defaults";
import type { DatabaseProviderType } from "@/features/data-sources/forms/database-provider-defaults";

function parseSslMode(value: string | null): DatabaseFormData["sslMode"] {
  if (value === null) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "disable" ||
    normalized === "prefer" ||
    normalized === "require"
  ) {
    return normalized;
  }

  return undefined;
}

function resolvePostgresConnectionStringSslMode(
  value: string | null,
  fallback: NonNullable<DatabaseFormData["sslMode"]>
): NonNullable<DatabaseFormData["sslMode"]> {
  return parseSslMode(value) ?? fallback;
}

export function parseConnectionString(
  connectionString: string,
  provider: DatabaseProviderType
): Partial<DatabaseFormData> | null {
  const trimmed = connectionString.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.replace(":", "");
    const defaults = getDatabaseProviderDefaults(provider);

    if (!defaults.supportedProtocols.includes(protocol)) {
      return null;
    }

    return {
      database: url.pathname.slice(1) || "",
      host: url.hostname || defaults.fallbackHost,
      password: decodeURIComponent(url.password) || "",
      port: url.port ? Number.parseInt(url.port, 10) : defaults.defaultPort,
      sslMode: defaults.isPostgresFamily
        ? resolvePostgresConnectionStringSslMode(
            url.searchParams.get("sslmode"),
            defaults.defaultSslMode
          )
        : undefined,
      username: decodeURIComponent(url.username) || "",
    };
  } catch {
    return null;
  }
}

export function buildConnectionStringPlaceholder(
  provider: DatabaseProviderType
) {
  return getDatabaseProviderDefaults(provider).connectionStringPlaceholder;
}

export function buildConnectionStringFormat(provider: DatabaseProviderType) {
  return getDatabaseProviderDefaults(provider).connectionStringFormat;
}

export function buildInvalidConnectionStringMessage(
  provider: DatabaseProviderType
) {
  return `Invalid connection string format. Expected: ${getDatabaseProviderDefaults(provider).invalidConnectionStringFormat}`;
}
