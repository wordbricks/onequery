import { z } from "zod";

const blankStringToUndefined = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().length === 0 ? undefined : value;
};

const trimmedString = (message: string) => z.string().trim().min(1, message);
const optionalTrimmedString = (message: string) =>
  z.preprocess(blankStringToUndefined, trimmedString(message).optional());
const requiredOpaqueString = (message: string) =>
  z.string().refine((value) => value.trim().length > 0, message);
const optionalOpaqueString = (message: string) =>
  z.preprocess(
    blankStringToUndefined,
    requiredOpaqueString(message).optional()
  );

const trimmedUrl = (requiredMessage: string, invalidMessage: string) =>
  z.string().trim().min(1, requiredMessage).pipe(z.url(invalidMessage));

const optionalTrimmedUrl = (invalidMessage: string) =>
  z.preprocess(
    blankStringToUndefined,
    z.string().trim().pipe(z.url(invalidMessage)).optional()
  );

const MONGODB_CONNECTION_STRING_SCHEMA = trimmedString(
  "Connection string is required"
).refine(
  (value) =>
    value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"),
  "Connection string must start with mongodb:// or mongodb+srv://"
);

export const SslModeSchema = z.enum(["disable", "prefer", "require"]);
export type SslMode = z.infer<typeof SslModeSchema>;

export const PostgresCredentialsSchema = z.object({
  database: trimmedString("Database name is required"),
  host: trimmedString("Host is required"),
  password: requiredOpaqueString("Password is required"),
  port: z.number().int().min(1).max(65535).default(5432),
  sslMode: SslModeSchema.default("prefer"),
  type: z.literal("postgres"),
  username: trimmedString("Username is required"),
});

export type PostgresCredentials = z.infer<typeof PostgresCredentialsSchema>;

export const MySQLCredentialsSchema = z.object({
  database: trimmedString("Database name is required"),
  host: trimmedString("Host is required"),
  password: requiredOpaqueString("Password is required"),
  port: z.number().int().min(1).max(65535).default(3306),
  sslMode: SslModeSchema.default("prefer"),
  type: z.literal("mysql"),
  username: trimmedString("Username is required"),
});

export type MySQLCredentials = z.infer<typeof MySQLCredentialsSchema>;

export const MongoDBCredentialsSchema = z.object({
  connectionString: MONGODB_CONNECTION_STRING_SCHEMA,
  database: optionalTrimmedString("Database name is required"),
  databases: z.array(trimmedString("Database name is required")).optional(),
  type: z.literal("mongodb"),
});

export type MongoDBCredentials = z.infer<typeof MongoDBCredentialsSchema>;

const ServiceAccountSchema = z.object({
  clientEmail: z
    .string()
    .trim()
    .min(1, "Client email is required")
    .pipe(z.email("Client email must be a valid email address")),
  privateKey: requiredOpaqueString("Private key is required"),
  privateKeyId: optionalOpaqueString("Private key ID is required"),
  projectId: trimmedString("Project ID is required"),
});

export const GoogleAnalyticsOAuthCredentialsSchema = z.object({
  accessToken: requiredOpaqueString("Access token is required"),
  authType: z.literal("oauth").optional(),
  expiresAt: z.number().int().min(0, "Expiration time must be positive"),
  propertyId: trimmedString("Property ID is required"),
  refreshToken: requiredOpaqueString("Refresh token is required"),
  type: z.literal("ga"),
});

export const GoogleAnalyticsServiceAccountCredentialsSchema = z.object({
  authType: z.literal("service_account"),
  propertyId: trimmedString("Property ID is required"),
  serviceAccount: ServiceAccountSchema,
  type: z.literal("ga"),
});

export const GoogleAnalyticsCredentialsSchema = z.union([
  GoogleAnalyticsOAuthCredentialsSchema,
  GoogleAnalyticsServiceAccountCredentialsSchema,
]);

export type GoogleAnalyticsCredentials = z.infer<
  typeof GoogleAnalyticsCredentialsSchema
>;
export type GoogleAnalyticsOAuthCredentials = z.infer<
  typeof GoogleAnalyticsOAuthCredentialsSchema
>;
export type GoogleAnalyticsServiceAccountCredentials = z.infer<
  typeof GoogleAnalyticsServiceAccountCredentialsSchema
>;

export const BigQueryOAuthCredentialsSchema = z.object({
  accessToken: requiredOpaqueString("Access token is required"),
  authType: z.literal("oauth").optional(),
  expiresAt: z.number().int().min(0, "Expiration time must be positive"),
  projectId: trimmedString("Project ID is required"),
  refreshToken: requiredOpaqueString("Refresh token is required"),
  type: z.literal("bigquery"),
});

export const BigQueryServiceAccountCredentialsSchema = z.object({
  authType: z.literal("service_account"),
  projectId: trimmedString("Project ID is required"),
  serviceAccount: ServiceAccountSchema,
  type: z.literal("bigquery"),
});

export const BigQueryCredentialsSchema = z.union([
  BigQueryOAuthCredentialsSchema,
  BigQueryServiceAccountCredentialsSchema,
]);

export type BigQueryCredentials = z.infer<typeof BigQueryCredentialsSchema>;
export type BigQueryOAuthCredentials = z.infer<
  typeof BigQueryOAuthCredentialsSchema
>;
export type BigQueryServiceAccountCredentials = z.infer<
  typeof BigQueryServiceAccountCredentialsSchema
>;

export const LaminarCredentialsSchema = z.object({
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiKey: requiredOpaqueString("API key is required"),
  type: z.literal("laminar"),
});

export type LaminarCredentials = z.infer<typeof LaminarCredentialsSchema>;

export const ConnectorCredentialsSchema = z.object({
  connectorId: trimmedString("Connector ID is required"),
  database: trimmedString("Athena database is required"),
  maxRows: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  type: z.literal("aws_athena_connector"),
  workgroup: optionalTrimmedString("Workgroup is required"),
});

export type ConnectorCredentials = z.infer<typeof ConnectorCredentialsSchema>;

export const AmplitudeCredentialsSchema = z.object({
  apiKey: requiredOpaqueString("API Key is required"),
  region: z.enum(["us", "eu"]).default("us"),
  secretKey: requiredOpaqueString("Secret Key is required"),
  type: z.literal("amplitude"),
});

export type AmplitudeCredentials = z.infer<typeof AmplitudeCredentialsSchema>;

export const MixpanelCredentialsSchema = z.object({
  projectId: trimmedString("Project ID is required"),
  region: z.enum(["us", "eu", "in"]).default("us"),
  secret: requiredOpaqueString("Service Account Secret is required"),
  type: z.literal("mixpanel"),
  username: trimmedString("Service Account Username is required"),
  workspaceId: optionalTrimmedString("Workspace ID is required"),
});

export type MixpanelCredentials = z.infer<typeof MixpanelCredentialsSchema>;

export const PostHogCredentialsSchema = z.object({
  hostUrl: trimmedUrl(
    "Host URL is required",
    "Host URL must be a valid URL"
  ).transform((value) => value.replace(/\/+$/, "")),
  personalApiKey: requiredOpaqueString("Personal API Key is required"),
  projectId: trimmedString("Project ID is required"),
  type: z.literal("posthog"),
});

export type PostHogCredentials = z.infer<typeof PostHogCredentialsSchema>;

export const SentryCredentialsSchema = z.object({
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  authToken: requiredOpaqueString("Auth token is required"),
  organizationSlug: trimmedString("Organization slug is required"),
  projectSlug: optionalTrimmedString("Project slug is required"),
  type: z.literal("sentry"),
});

export type SentryCredentials = z.infer<typeof SentryCredentialsSchema>;

export const GitHubCredentialsSchema = z.object({
  accessToken: requiredOpaqueString("Access token is required"),
  installationId: optionalTrimmedString("Installation ID is required"),
  repositories: z.array(trimmedString("Repository is required")).optional(),
  type: z.literal("github"),
});

export type GitHubCredentials = z.infer<typeof GitHubCredentialsSchema>;

export const LinearApiKeyCredentialsSchema = z.object({
  apiKey: requiredOpaqueString("API key is required"),
  type: z.literal("linear"),
});

export const LinearOAuthCredentialsSchema = z.object({
  accessToken: requiredOpaqueString("Access token is required"),
  appUserId: optionalTrimmedString("App user ID is required"),
  expiresAt: optionalTrimmedString("Expiration timestamp is required"),
  linearOrganizationId: trimmedString("Linear organization ID is required"),
  linearOrganizationName: optionalTrimmedString(
    "Linear organization name is required"
  ),
  refreshToken: optionalOpaqueString("Refresh token is required"),
  scope: optionalTrimmedString("Scope is required"),
  tokenType: optionalTrimmedString("Token type is required"),
  type: z.literal("linear"),
});

export const LinearCredentialsSchema = z.union([
  LinearApiKeyCredentialsSchema,
  LinearOAuthCredentialsSchema,
]);

export type LinearCredentials = z.infer<typeof LinearCredentialsSchema>;

export const CredentialsSchema = z.union([
  PostgresCredentialsSchema,
  MySQLCredentialsSchema,
  MongoDBCredentialsSchema,
  GoogleAnalyticsCredentialsSchema,
  BigQueryCredentialsSchema,
  LaminarCredentialsSchema,
  ConnectorCredentialsSchema,
  AmplitudeCredentialsSchema,
  MixpanelCredentialsSchema,
  PostHogCredentialsSchema,
  SentryCredentialsSchema,
  GitHubCredentialsSchema,
  LinearCredentialsSchema,
]);

export type Credentials = z.infer<typeof CredentialsSchema>;

export type CredentialProviderType = Credentials["type"];

export const DATABASE_CREDENTIAL_PROVIDER = {
  BIGQUERY: "bigquery",
  CONNECTOR: "aws_athena_connector",
  LAMINAR: "laminar",
  MYSQL: "mysql",
  POSTGRES: "postgres",
} as const satisfies Record<string, CredentialProviderType>;

export type DatabaseCredentialProviderType =
  (typeof DATABASE_CREDENTIAL_PROVIDER)[keyof typeof DATABASE_CREDENTIAL_PROVIDER];

export const DATABASE_CREDENTIAL_PROVIDER_TYPES = [
  DATABASE_CREDENTIAL_PROVIDER.POSTGRES,
  DATABASE_CREDENTIAL_PROVIDER.MYSQL,
  DATABASE_CREDENTIAL_PROVIDER.BIGQUERY,
  DATABASE_CREDENTIAL_PROVIDER.LAMINAR,
  DATABASE_CREDENTIAL_PROVIDER.CONNECTOR,
] as const satisfies readonly DatabaseCredentialProviderType[];

export type DatabaseCredentials = Extract<
  Credentials,
  { type: DatabaseCredentialProviderType }
>;

export const credentialSchemaMap = {
  amplitude: AmplitudeCredentialsSchema,
  aws_athena_connector: ConnectorCredentialsSchema,
  bigquery: BigQueryCredentialsSchema,
  ga: GoogleAnalyticsCredentialsSchema,
  github: GitHubCredentialsSchema,
  laminar: LaminarCredentialsSchema,
  linear: LinearCredentialsSchema,
  mixpanel: MixpanelCredentialsSchema,
  mongodb: MongoDBCredentialsSchema,
  mysql: MySQLCredentialsSchema,
  postgres: PostgresCredentialsSchema,
  posthog: PostHogCredentialsSchema,
  sentry: SentryCredentialsSchema,
} as const;

export function validateCredentials(credentials: unknown): Credentials {
  return CredentialsSchema.parse(credentials);
}

export function safeValidateCredentials(credentials: unknown) {
  return CredentialsSchema.safeParse(credentials);
}

export function isTokenExpired(
  expiresAt: number,
  bufferMs = 5 * 60 * 1000
): boolean {
  return Date.now() >= expiresAt - bufferMs;
}

export function isOAuthCredentials(
  credentials: Credentials
): credentials is GoogleAnalyticsOAuthCredentials | BigQueryOAuthCredentials {
  if (credentials.type !== "ga" && credentials.type !== "bigquery") {
    return false;
  }
  if ("authType" in credentials && credentials.authType === "service_account") {
    return false;
  }
  return true;
}

export function isDatabaseCredentials(
  credentials: Credentials
): credentials is DatabaseCredentials {
  return isDatabaseCredentialProviderType(credentials.type);
}

export function isDatabaseCredentialProviderType(
  provider: CredentialProviderType
): provider is DatabaseCredentialProviderType {
  return DATABASE_CREDENTIAL_PROVIDER_TYPES.some((value) => value === provider);
}

export function isMongoCredentials(
  credentials: Credentials
): credentials is MongoDBCredentials {
  return credentials.type === "mongodb";
}

export function isAnalyticsCredentials(
  credentials: Credentials
): credentials is
  | AmplitudeCredentials
  | MixpanelCredentials
  | PostHogCredentials {
  return (
    credentials.type === "amplitude" ||
    credentials.type === "mixpanel" ||
    credentials.type === "posthog"
  );
}

export function isGitHubCredentials(
  credentials: Credentials
): credentials is GitHubCredentials {
  return credentials.type === "github";
}

export function isLinearCredentials(
  credentials: Credentials
): credentials is LinearCredentials {
  return credentials.type === "linear";
}

export function normalizeEnvVarName(name: string): string {
  return name
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .replaceAll(/_+/g, "_");
}
