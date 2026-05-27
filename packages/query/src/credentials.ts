export type SslMode = "disable" | "prefer" | "require";

export type PostgresCredentials = {
  database: string;
  host: string;
  password: string;
  port: number;
  sslMode: SslMode;
  type: "postgres";
  username: string;
};

export type MySQLCredentials = {
  database: string;
  host: string;
  password: string;
  port: number;
  sslMode: SslMode;
  type: "mysql";
  username: string;
};

export type SnowflakeCredentials = {
  account: string;
  database: string;
  password: string;
  role?: string;
  schema?: string;
  type: "snowflake";
  username: string;
  warehouse: string;
};

export type BigQueryServiceAccount = {
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
  projectId: string;
};

export type BigQueryOAuthCredentials = {
  accessToken: string;
  authType?: "oauth";
  expiresAt: number;
  projectId: string;
  refreshToken: string;
  type: "bigquery";
};

export type BigQueryServiceAccountCredentials = {
  authType: "service_account";
  projectId: string;
  serviceAccount: BigQueryServiceAccount;
  type: "bigquery";
};

export type BigQueryCredentials =
  | BigQueryOAuthCredentials
  | BigQueryServiceAccountCredentials;

export type CloudflareD1Credentials = {
  accountId: string;
  apiBaseUrl?: string;
  apiToken: string;
  databaseId: string;
  type: "cloudflare_d1";
};

export type LaminarCredentials = {
  apiBaseUrl?: string;
  apiKey: string;
  type: "laminar";
};

export type MotherDuckCredentials = {
  database: string;
  host: string;
  port: number;
  token: string;
  type: "motherduck";
  username: string;
};

export type ConnectorCredentials = {
  connectorId: string;
  database: string;
  maxRows?: number;
  timeoutMs?: number;
  type: "aws_athena_connector";
  workgroup?: string;
};

export type DatabaseCredentials =
  | PostgresCredentials
  | MySQLCredentials
  | SnowflakeCredentials
  | BigQueryCredentials
  | CloudflareD1Credentials
  | LaminarCredentials
  | MotherDuckCredentials
  | ConnectorCredentials;

export type DatabaseCredentialProviderType = DatabaseCredentials["type"];
export type QueryProviderId = DatabaseCredentialProviderType;

export const QUERY_PROVIDER_IDS = [
  "postgres",
  "mysql",
  "snowflake",
  "bigquery",
  "cloudflare_d1",
  "laminar",
  "motherduck",
  "aws_athena_connector",
] as const satisfies readonly QueryProviderId[];

export function isQueryProviderId(value: string): value is QueryProviderId {
  return QUERY_PROVIDER_IDS.some((provider) => provider === value);
}
