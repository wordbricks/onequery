import { z } from "zod";

const trimmedString = (message: string) => z.string().trim().min(1, message);
// Keep `.optional()` at the outermost layer so Hono infers these request
// fields as optional instead of required `unknown`.
const optionalTrimmedString = (message: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? undefined : value))
    .pipe(trimmedString(message).optional())
    .optional();
const requiredOpaqueString = (message: string) =>
  z.string().refine((value) => value.trim().length > 0, message);
const optionalOpaqueString = (message: string) =>
  z
    .string()
    .transform((value) => (value.trim().length === 0 ? undefined : value))
    .pipe(requiredOpaqueString(message).optional())
    .optional();

const trimmedUrl = (requiredMessage: string, invalidMessage: string) =>
  z.string().trim().min(1, requiredMessage).pipe(z.url(invalidMessage));

const optionalTrimmedUrl = (invalidMessage: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? undefined : value))
    .pipe(z.url(invalidMessage).optional())
    .optional();

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

export const SnowflakeCredentialsSchema = z.object({
  account: trimmedString("Account identifier is required"),
  database: trimmedString("Database name is required"),
  password: requiredOpaqueString("Password is required"),
  role: optionalTrimmedString("Role is required"),
  schema: optionalTrimmedString("Schema is required"),
  type: z.literal("snowflake"),
  username: trimmedString("Username is required"),
  warehouse: trimmedString("Warehouse is required"),
});

export type SnowflakeCredentials = z.infer<typeof SnowflakeCredentialsSchema>;

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

export const YouTubeAnalyticsCredentialsSchema = z.object({
  accessToken: requiredOpaqueString("Access token is required"),
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  authType: z.literal("oauth").optional(),
  expiresAt: z.number().int().min(0, "Expiration time must be positive"),
  refreshToken: requiredOpaqueString("Refresh token is required"),
  type: z.literal("youtube_analytics"),
});

export type YouTubeAnalyticsCredentials = z.infer<
  typeof YouTubeAnalyticsCredentialsSchema
>;

export const LaminarCredentialsSchema = z.object({
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiKey: requiredOpaqueString("API key is required"),
  type: z.literal("laminar"),
});

export type LaminarCredentials = z.infer<typeof LaminarCredentialsSchema>;

const DEFAULT_MOTHERDUCK_POSTGRES_HOST = "pg.us-east-1-aws.motherduck.com";
const DEFAULT_MOTHERDUCK_DATABASE = "md:";

function normalizeMotherDuckDatabase(database: string): string {
  return database.startsWith("md:") ? database : `md:${database}`;
}

export const MotherDuckCredentialsSchema = z.object({
  database: trimmedString("MotherDuck database is required")
    .default(DEFAULT_MOTHERDUCK_DATABASE)
    .transform(normalizeMotherDuckDatabase),
  host: trimmedString("MotherDuck host is required").default(
    DEFAULT_MOTHERDUCK_POSTGRES_HOST
  ),
  port: z.number().int().min(1).max(65535).default(5432),
  token: requiredOpaqueString("MotherDuck token is required"),
  type: z.literal("motherduck"),
  username: trimmedString("MotherDuck username is required").default(
    "postgres"
  ),
});

export type MotherDuckCredentials = z.infer<typeof MotherDuckCredentialsSchema>;

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

export const AirtableCredentialsSchema = z.object({
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  baseId: optionalTrimmedString("Base ID is required"),
  personalAccessToken: requiredOpaqueString(
    "Personal access token is required"
  ),
  type: z.literal("airtable"),
});

export type AirtableCredentials = z.infer<typeof AirtableCredentialsSchema>;

export const DiscordCredentialsSchema = z.object({
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  authScheme: z.enum(["bot", "bearer"]).default("bot"),
  guildId: optionalTrimmedString("Guild ID is required"),
  token: requiredOpaqueString("Token is required"),
  type: z.literal("discord"),
});

export type DiscordCredentials = z.infer<typeof DiscordCredentialsSchema>;

const parseSlackScopeList = (scope: string): string[] =>
  scope
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const SlackCredentialsBaseSchema = z.object({
  botToken: requiredOpaqueString("Bot token is required"),
  botUserId: z.string(),
  teamId: trimmedString("Team ID is required"),
  teamName: z.string(),
  type: z.literal("slack"),
});

const CanonicalSlackCredentialsSchema = SlackCredentialsBaseSchema.extend({
  botScopes: z.array(z.string()),
});

const LegacySlackCredentialsSchema = SlackCredentialsBaseSchema.extend({
  botScopes: z.array(z.string()).optional(),
  scope: z.string(),
});

export const SlackCredentialsSchema = z
  .union([CanonicalSlackCredentialsSchema, LegacySlackCredentialsSchema])
  .transform((credentials) => {
    if ("scope" in credentials) {
      // Comment: Older Slack installs stored a comma-delimited `scope` string.
      // Normalize on read so source-api adapters only receive `botScopes`.
      return {
        botScopes:
          credentials.botScopes ?? parseSlackScopeList(credentials.scope),
        botToken: credentials.botToken,
        botUserId: credentials.botUserId,
        teamId: credentials.teamId,
        teamName: credentials.teamName,
        type: credentials.type,
      };
    }

    return credentials;
  });

export type SlackCredentials = z.infer<typeof SlackCredentialsSchema>;

export const CalCredentialsSchema = z.object({
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiKey: requiredOpaqueString("API key is required"),
  apiVersion: trimmedString("API version is required").default("2026-05-01"),
  type: z.literal("cal"),
});

export type CalCredentials = z.infer<typeof CalCredentialsSchema>;

export const GranolaCredentialsSchema = z.object({
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiKey: requiredOpaqueString("API key is required"),
  type: z.literal("granola"),
});

export type GranolaCredentials = z.infer<typeof GranolaCredentialsSchema>;

export const GoogleSearchConsoleOAuthCredentialsSchema = z.object({
  accessToken: requiredOpaqueString("Access token is required"),
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  authType: z.literal("oauth").optional(),
  expiresAt: z.number().int().min(0, "Expiration time must be positive"),
  refreshToken: requiredOpaqueString("Refresh token is required"),
  siteUrl: optionalTrimmedString("Site URL is required"),
  type: z.literal("google_search_console"),
});

export const GoogleSearchConsoleAccessTokenCredentialsSchema = z.object({
  accessToken: requiredOpaqueString("Access token is required"),
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  siteUrl: optionalTrimmedString("Site URL is required"),
  type: z.literal("google_search_console"),
});

export const GoogleSearchConsoleCredentialsSchema = z.union([
  GoogleSearchConsoleOAuthCredentialsSchema,
  GoogleSearchConsoleAccessTokenCredentialsSchema,
]);

export type GoogleSearchConsoleCredentials = z.infer<
  typeof GoogleSearchConsoleCredentialsSchema
>;
export type GoogleSearchConsoleOAuthCredentials = z.infer<
  typeof GoogleSearchConsoleOAuthCredentialsSchema
>;
export type GoogleSearchConsoleAccessTokenCredentials = z.infer<
  typeof GoogleSearchConsoleAccessTokenCredentialsSchema
>;

export const ConfluenceCredentialsSchema = z.object({
  apiToken: requiredOpaqueString("API token is required"),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .pipe(z.email("Email must be a valid email address")),
  siteUrl: trimmedUrl(
    "Site URL is required",
    "Site URL must be a valid URL"
  ).transform((value) => value.replace(/\/+$/, "")),
  type: z.literal("confluence"),
});

export type ConfluenceCredentials = z.infer<typeof ConfluenceCredentialsSchema>;

export const AmazonAdsCredentialsSchema = z.object({
  accessToken: requiredOpaqueString("Access token is required"),
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  clientId: trimmedString("Client ID is required"),
  profileId: optionalTrimmedString("Profile ID is required"),
  region: z.enum(["na", "eu", "fe"]).default("na"),
  type: z.literal("amazon_ads"),
});

export type AmazonAdsCredentials = z.infer<typeof AmazonAdsCredentialsSchema>;

export const LinkedInAdsCredentialsSchema = z.object({
  accessToken: requiredOpaqueString("Access token is required"),
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiVersion: trimmedString("API version is required").default("202605"),
  type: z.literal("linkedin_ads"),
});

export type LinkedInAdsCredentials = z.infer<
  typeof LinkedInAdsCredentialsSchema
>;

export const TikTokMarketingCredentialsSchema = z.object({
  accessToken: requiredOpaqueString("Access token is required"),
  advertiserId: optionalTrimmedString("Advertiser ID is required"),
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  type: z.literal("tiktok_marketing"),
});

export type TikTokMarketingCredentials = z.infer<
  typeof TikTokMarketingCredentialsSchema
>;

export const SendGridCredentialsSchema = z.object({
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiKey: requiredOpaqueString("API key is required"),
  type: z.literal("sendgrid"),
});

export type SendGridCredentials = z.infer<typeof SendGridCredentialsSchema>;

export const JiraCredentialsSchema = z.object({
  apiToken: requiredOpaqueString("API token is required"),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .pipe(z.email("Email must be a valid email address")),
  siteUrl: trimmedUrl(
    "Site URL is required",
    "Site URL must be a valid URL"
  ).transform((value) => value.replace(/\/+$/, "")),
  type: z.literal("jira"),
});

export type JiraCredentials = z.infer<typeof JiraCredentialsSchema>;

export const VercelCredentialsSchema = z.object({
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiToken: requiredOpaqueString("API token is required"),
  type: z.literal("vercel"),
});

export type VercelCredentials = z.infer<typeof VercelCredentialsSchema>;

export const E2BCredentialsSchema = z.object({
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiKey: requiredOpaqueString("API key is required"),
  type: z.literal("e2b"),
});

export type E2BCredentials = z.infer<typeof E2BCredentialsSchema>;

export const HermesCredentialsSchema = z.object({
  apiBaseUrl: trimmedUrl(
    "API base URL is required",
    "API base URL must be a valid URL"
  ).transform((value) => value.replace(/\/+$/, "")),
  apiKey: requiredOpaqueString("API key is required"),
  type: z.literal("hermes"),
});

export type HermesCredentials = z.infer<typeof HermesCredentialsSchema>;

export const MicrosoftClarityCredentialsSchema = z.object({
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiToken: requiredOpaqueString("API token is required"),
  type: z.literal("microsoft_clarity"),
});

export type MicrosoftClarityCredentials = z.infer<
  typeof MicrosoftClarityCredentialsSchema
>;

const OnePasswordConnectCredentialsSchema = z.object({
  accessToken: requiredOpaqueString("Access token is required"),
  apiBaseUrl: trimmedUrl(
    "API base URL is required",
    "API base URL must be a valid URL"
  ).transform((value) => value.replace(/\/+$/, "")),
  authMethod: z.literal("connect").optional(),
  type: z.literal("onepassword"),
});

const OnePasswordServiceAccountCredentialsSchema = z.object({
  authMethod: z.literal("service_account").optional(),
  integrationName: optionalTrimmedString("Integration name is required"),
  integrationVersion: optionalTrimmedString("Integration version is required"),
  serviceAccountToken: requiredOpaqueString(
    "Service account token is required"
  ),
  type: z.literal("onepassword"),
});

export const OnePasswordCredentialsSchema = z.union([
  OnePasswordConnectCredentialsSchema,
  OnePasswordServiceAccountCredentialsSchema,
]);

export type OnePasswordCredentials = z.infer<
  typeof OnePasswordCredentialsSchema
>;

export const CloudflareD1CredentialsSchema = z.object({
  accountId: trimmedString("Account ID is required"),
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiToken: requiredOpaqueString("API token is required"),
  databaseId: trimmedString("Database ID is required"),
  type: z.literal("cloudflare_d1"),
});

export type CloudflareD1Credentials = z.infer<
  typeof CloudflareD1CredentialsSchema
>;

export const CloudflareR2SqlCredentialsSchema = z.object({
  accountId: trimmedString("Account ID is required"),
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiToken: requiredOpaqueString("API token is required"),
  bucketName: trimmedString("Bucket name is required"),
  type: z.literal("cloudflare_r2_sql"),
});

export type CloudflareR2SqlCredentials = z.infer<
  typeof CloudflareR2SqlCredentialsSchema
>;

export const CloudflareWorkersObservabilityCredentialsSchema = z.object({
  accountId: trimmedString("Account ID is required"),
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiToken: requiredOpaqueString("API token is required"),
  scriptName: optionalTrimmedString("Worker script name is required"),
  type: z.literal("cloudflare_workers_observability"),
});

export type CloudflareWorkersObservabilityCredentials = z.infer<
  typeof CloudflareWorkersObservabilityCredentialsSchema
>;

export const CloudflareWebAnalyticsCredentialsSchema = z.object({
  accountId: trimmedString("Account ID is required"),
  apiBaseUrl: optionalTrimmedUrl("API base URL must be a valid URL"),
  apiToken: requiredOpaqueString("API token is required"),
  siteTag: optionalTrimmedString("Web Analytics site tag is required"),
  type: z.literal("cloudflare_web_analytics"),
});

export type CloudflareWebAnalyticsCredentials = z.infer<
  typeof CloudflareWebAnalyticsCredentialsSchema
>;

export const LINEAR_ACCESS_MODES = ["mention", "read", "read_write"] as const;

export const LinearAccessModeSchema = z.enum(LINEAR_ACCESS_MODES);

export type LinearAccessMode = z.infer<typeof LinearAccessModeSchema>;

export const LinearApiKeyCredentialsSchema = z.object({
  accessMode: LinearAccessModeSchema.optional(),
  apiKey: requiredOpaqueString("API key is required"),
  type: z.literal("linear"),
});

export type LinearApiKeyCredentials = z.infer<
  typeof LinearApiKeyCredentialsSchema
>;

export const LinearOAuthCredentialsSchema = z.object({
  accessMode: LinearAccessModeSchema.optional(),
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

export type LinearOAuthCredentials = z.infer<
  typeof LinearOAuthCredentialsSchema
>;

export const LinearCredentialsSchema = z.union([
  LinearApiKeyCredentialsSchema,
  LinearOAuthCredentialsSchema,
]);

export type LinearCredentials = z.infer<typeof LinearCredentialsSchema>;

export function getLinearAccessMode(
  credentials: LinearCredentials
): LinearAccessMode {
  if (credentials.accessMode) {
    return credentials.accessMode;
  }

  if ("scope" in credentials) {
    const scopes = new Set(
      (credentials.scope ?? "")
        .split(/[\s,]+/)
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0)
    );
    if (scopes.has("write")) {
      return "read_write";
    }
    if (scopes.has("read")) {
      return "read";
    }
  }

  return "read_write";
}

export const CredentialsSchema = z.union([
  PostgresCredentialsSchema,
  MySQLCredentialsSchema,
  MongoDBCredentialsSchema,
  GoogleAnalyticsCredentialsSchema,
  BigQueryCredentialsSchema,
  YouTubeAnalyticsCredentialsSchema,
  SnowflakeCredentialsSchema,
  LaminarCredentialsSchema,
  MotherDuckCredentialsSchema,
  ConnectorCredentialsSchema,
  AmplitudeCredentialsSchema,
  MixpanelCredentialsSchema,
  PostHogCredentialsSchema,
  SentryCredentialsSchema,
  GitHubCredentialsSchema,
  AirtableCredentialsSchema,
  DiscordCredentialsSchema,
  SlackCredentialsSchema,
  CalCredentialsSchema,
  GranolaCredentialsSchema,
  GoogleSearchConsoleCredentialsSchema,
  ConfluenceCredentialsSchema,
  AmazonAdsCredentialsSchema,
  LinkedInAdsCredentialsSchema,
  TikTokMarketingCredentialsSchema,
  SendGridCredentialsSchema,
  JiraCredentialsSchema,
  VercelCredentialsSchema,
  E2BCredentialsSchema,
  HermesCredentialsSchema,
  MicrosoftClarityCredentialsSchema,
  OnePasswordCredentialsSchema,
  CloudflareD1CredentialsSchema,
  CloudflareR2SqlCredentialsSchema,
  CloudflareWorkersObservabilityCredentialsSchema,
  CloudflareWebAnalyticsCredentialsSchema,
  LinearCredentialsSchema,
]);

export type Credentials = z.infer<typeof CredentialsSchema>;

export type CredentialProviderType = Credentials["type"];

export const DATABASE_CREDENTIAL_PROVIDER = {
  BIGQUERY: "bigquery",
  CLOUDFLARE_D1: "cloudflare_d1",
  CLOUDFLARE_R2_SQL: "cloudflare_r2_sql",
  CONNECTOR: "aws_athena_connector",
  LAMINAR: "laminar",
  MOTHERDUCK: "motherduck",
  MYSQL: "mysql",
  POSTGRES: "postgres",
  SNOWFLAKE: "snowflake",
} as const satisfies Record<string, CredentialProviderType>;

export type DatabaseCredentialProviderType =
  (typeof DATABASE_CREDENTIAL_PROVIDER)[keyof typeof DATABASE_CREDENTIAL_PROVIDER];

export const DATABASE_CREDENTIAL_PROVIDER_TYPES = [
  DATABASE_CREDENTIAL_PROVIDER.POSTGRES,
  DATABASE_CREDENTIAL_PROVIDER.MYSQL,
  DATABASE_CREDENTIAL_PROVIDER.SNOWFLAKE,
  DATABASE_CREDENTIAL_PROVIDER.BIGQUERY,
  DATABASE_CREDENTIAL_PROVIDER.CLOUDFLARE_D1,
  DATABASE_CREDENTIAL_PROVIDER.CLOUDFLARE_R2_SQL,
  DATABASE_CREDENTIAL_PROVIDER.LAMINAR,
  DATABASE_CREDENTIAL_PROVIDER.MOTHERDUCK,
  DATABASE_CREDENTIAL_PROVIDER.CONNECTOR,
] as const satisfies readonly DatabaseCredentialProviderType[];

export type DatabaseCredentials = Extract<
  Credentials,
  { type: DatabaseCredentialProviderType }
>;

export const credentialSchemaMap = {
  amplitude: AmplitudeCredentialsSchema,
  amazon_ads: AmazonAdsCredentialsSchema,
  airtable: AirtableCredentialsSchema,
  aws_athena_connector: ConnectorCredentialsSchema,
  bigquery: BigQueryCredentialsSchema,
  cal: CalCredentialsSchema,
  cloudflare_d1: CloudflareD1CredentialsSchema,
  cloudflare_r2_sql: CloudflareR2SqlCredentialsSchema,
  confluence: ConfluenceCredentialsSchema,
  discord: DiscordCredentialsSchema,
  e2b: E2BCredentialsSchema,
  ga: GoogleAnalyticsCredentialsSchema,
  github: GitHubCredentialsSchema,
  google_search_console: GoogleSearchConsoleCredentialsSchema,
  granola: GranolaCredentialsSchema,
  hermes: HermesCredentialsSchema,
  jira: JiraCredentialsSchema,
  linkedin_ads: LinkedInAdsCredentialsSchema,
  cloudflare_workers_observability:
    CloudflareWorkersObservabilityCredentialsSchema,
  cloudflare_web_analytics: CloudflareWebAnalyticsCredentialsSchema,
  laminar: LaminarCredentialsSchema,
  linear: LinearCredentialsSchema,
  microsoft_clarity: MicrosoftClarityCredentialsSchema,
  mixpanel: MixpanelCredentialsSchema,
  motherduck: MotherDuckCredentialsSchema,
  mongodb: MongoDBCredentialsSchema,
  mysql: MySQLCredentialsSchema,
  onepassword: OnePasswordCredentialsSchema,
  postgres: PostgresCredentialsSchema,
  posthog: PostHogCredentialsSchema,
  sendgrid: SendGridCredentialsSchema,
  sentry: SentryCredentialsSchema,
  slack: SlackCredentialsSchema,
  snowflake: SnowflakeCredentialsSchema,
  tiktok_marketing: TikTokMarketingCredentialsSchema,
  vercel: VercelCredentialsSchema,
  youtube_analytics: YouTubeAnalyticsCredentialsSchema,
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
): credentials is
  | GoogleAnalyticsOAuthCredentials
  | BigQueryOAuthCredentials
  | GoogleSearchConsoleOAuthCredentials
  | YouTubeAnalyticsCredentials {
  if (credentials.type === "google_search_console") {
    return "refreshToken" in credentials && "expiresAt" in credentials;
  }
  if (
    credentials.type !== "ga" &&
    credentials.type !== "bigquery" &&
    credentials.type !== "youtube_analytics"
  ) {
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

export function isSlackCredentials(
  credentials: Credentials
): credentials is SlackCredentials {
  return credentials.type === "slack";
}

export function normalizeEnvVarName(name: string): string {
  return name
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .replaceAll(/_+/g, "_");
}
