import type { z } from "zod";

import {
  AmplitudeCredentialsSchema,
  AmazonAdsCredentialsSchema,
  AirtableCredentialsSchema,
  BigQueryCredentialsSchema,
  CalCredentialsSchema,
  CodexAppServerApiCredentialsSchema,
  CloudflareD1CredentialsSchema,
  CloudflareR2SqlCredentialsSchema,
  CloudflareWebAnalyticsCredentialsSchema,
  CloudflareWorkersObservabilityCredentialsSchema,
  ConfluenceCredentialsSchema,
  ConnectorCredentialsSchema,
  DiscordCredentialsSchema,
  E2BCredentialsSchema,
  FigmaCredentialsSchema,
  GitHubCredentialsSchema,
  GoogleSearchConsoleCredentialsSchema,
  GoogleAnalyticsCredentialsSchema,
  GranolaCredentialsSchema,
  HermesCredentialsSchema,
  JamCredentialsSchema,
  JiraCredentialsSchema,
  LaminarCredentialsSchema,
  LinkedInAdsCredentialsSchema,
  LinearCredentialsSchema,
  MicrosoftClarityCredentialsSchema,
  MixpanelCredentialsSchema,
  MotherDuckCredentialsSchema,
  MongoDBCredentialsSchema,
  MySQLCredentialsSchema,
  OnePasswordCredentialsSchema,
  PostgresCredentialsSchema,
  PostHogCredentialsSchema,
  SendGridCredentialsSchema,
  SentryCredentialsSchema,
  SlackCredentialsSchema,
  SnowflakeCredentialsSchema,
  TikTokMarketingCredentialsSchema,
  VercelCredentialsSchema,
  YouTubeAnalyticsCredentialsSchema,
} from "./credentials";
import type { Credentials } from "./credentials";

type ProviderCredentialSchema = z.ZodType<{ type: string }>;

type SourceProviderGuide = {
  summary: string;
  steps: readonly string[];
  exampleInput: {
    sourceKey: string;
    credentials: Record<string, unknown>;
  };
};

type SourceProviderGoogleOAuth = {
  credentialDefaults: Record<string, unknown>;
  scopes: readonly string[];
};

export type SourceProviderPublicCategory =
  | "Databases"
  | "Developer workflow"
  | "Marketing"
  | "Observability"
  | "Product analytics"
  | "Productivity"
  | "Warehouses";

type SourceProviderDefinition = {
  label: string;
  credentialSchema: ProviderCredentialSchema;
  credentialType: string;
  connectable: boolean;
  analysisSource: boolean;
  queryInterface: boolean;
  sourceApiInterface: boolean;
  testable: boolean;
  dashboardConnectable: boolean;
  dashboardCredentialForm: string;
  googleOAuth?: SourceProviderGoogleOAuth;
  publicCategory: SourceProviderPublicCategory;
  guide: SourceProviderGuide;
};

export const GOOGLE_OAUTH_SCOPES = {
  ANALYTICS_READONLY: "https://www.googleapis.com/auth/analytics.readonly",
  BIGQUERY_DATA_READONLY:
    "https://www.googleapis.com/auth/cloud-platform.read-only",
  BIGQUERY_READONLY: "https://www.googleapis.com/auth/bigquery.readonly",
  YOUTUBE_READONLY: "https://www.googleapis.com/auth/youtube.readonly",
  YOUTUBE_ANALYTICS_READONLY:
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  WEBMASTERS_READONLY: "https://www.googleapis.com/auth/webmasters.readonly",
} as const;

export const SOURCE_PROVIDER_REGISTRY = {
  postgres: {
    label: "PostgreSQL",
    credentialSchema: PostgresCredentialsSchema,
    credentialType: "postgres",
    connectable: true,
    analysisSource: true,
    queryInterface: true,
    sourceApiInterface: false,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "database",
    publicCategory: "Databases",
    guide: {
      summary:
        "Connect a Postgres database with a direct host, database, and login.",
      steps: [
        "Retrieve the Postgres host, database name, username, and password from the database deployment or secret manager.",
        "Confirm the correct port and SSL mode for this environment before sending the payload.",
      ],
      exampleInput: {
        sourceKey: "warehouse",
        credentials: {
          host: "db.example.com",
          port: 5432,
          database: "app",
          username: "onequery",
          password: "secret",
          sslMode: "prefer",
        },
      },
    },
  },
  supabase: {
    label: "Supabase",
    credentialSchema: PostgresCredentialsSchema,
    credentialType: "postgres",
    connectable: true,
    analysisSource: true,
    queryInterface: true,
    sourceApiInterface: false,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "database",
    publicCategory: "Databases",
    guide: {
      summary:
        "Connect Supabase with the session pooler host, database, and login credentials over the Postgres wire protocol.",
      steps: [
        "Open the Supabase Connect panel and retrieve the Session pooler host, database name, username, and password.",
        "Use the Supabase provider with the Postgres connection fields shown below.",
        "Prefer the Session pooler for OneQuery's persistent backend connection path. Keep SSL enabled and confirm the correct port before building the payload.",
      ],
      exampleInput: {
        sourceKey: "supabase_prod",
        credentials: {
          host: "aws-0-us-east-1.pooler.supabase.com",
          port: 5432,
          database: "postgres",
          username: "postgres.project-ref",
          password: "supabase-db-password",
          sslMode: "require",
        },
      },
    },
  },
  mysql: {
    label: "MySQL",
    credentialSchema: MySQLCredentialsSchema,
    credentialType: "mysql",
    connectable: true,
    analysisSource: true,
    queryInterface: true,
    sourceApiInterface: false,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "database",
    publicCategory: "Databases",
    guide: {
      summary:
        "Connect a MySQL database with host, schema, and login credentials.",
      steps: [
        "Retrieve the MySQL host, database name, username, and password from the deployment or secret manager.",
        "Confirm the port and SSL requirement before building the payload.",
      ],
      exampleInput: {
        sourceKey: "mysql_prod",
        credentials: {
          host: "mysql.example.com",
          port: 3306,
          database: "app",
          username: "onequery",
          password: "secret",
          sslMode: "prefer",
        },
      },
    },
  },
  snowflake: {
    label: "Snowflake",
    credentialSchema: SnowflakeCredentialsSchema,
    credentialType: "snowflake",
    connectable: true,
    analysisSource: true,
    queryInterface: true,
    sourceApiInterface: false,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "snowflake",
    publicCategory: "Warehouses",
    guide: {
      summary:
        "Connect Snowflake with an account identifier, warehouse, database, and login credentials.",
      steps: [
        "Create or choose a Snowflake role with read access to the target database and schemas.",
        "Grant the role USAGE on the warehouse, database, and schema plus SELECT on the tables or views OneQuery should query.",
        "Copy the account identifier, username, password, warehouse, database, optional schema, and optional role into the payload.",
      ],
      exampleInput: {
        sourceKey: "snowflake_prod",
        credentials: {
          account: "xy12345.us-east-1",
          warehouse: "ANALYTICS_WH",
          database: "ANALYTICS",
          schema: "PUBLIC",
          username: "ONEQUERY_READER",
          password: "secret",
          role: "ONEQUERY_READONLY",
        },
      },
    },
  },
  mongodb: {
    label: "MongoDB",
    credentialSchema: MongoDBCredentialsSchema,
    credentialType: "mongodb",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "mongodb",
    publicCategory: "Databases",
    guide: {
      summary:
        "Connect MongoDB with one connection string plus database selection.",
      steps: [
        "Retrieve a MongoDB connection string with the required read access.",
        "If the deployment spans multiple databases, include `databases`; otherwise provide one `database`.",
      ],
      exampleInput: {
        sourceKey: "mongo_analytics",
        credentials: {
          connectionString: "mongodb+srv://user:password@cluster.example.com",
          database: "analytics",
        },
      },
    },
  },
  bigquery: {
    label: "BigQuery",
    credentialSchema: BigQueryCredentialsSchema,
    credentialType: "bigquery",
    connectable: true,
    analysisSource: true,
    queryInterface: true,
    sourceApiInterface: false,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "google_service_account",
    googleOAuth: {
      credentialDefaults: { projectId: "" },
      scopes: [GOOGLE_OAUTH_SCOPES.BIGQUERY_READONLY],
    },
    publicCategory: "Warehouses",
    guide: {
      summary:
        "Connect BigQuery with either Google OAuth tokens or a Google Cloud service account JSON key.",
      steps: [
        "Retrieve the Google Cloud `projectId` that owns the datasets OneQuery should query.",
        "For the live service-account flow, create a Google Cloud service account in that project, grant `BigQuery Data Viewer` and `BigQuery Job User`, then create a JSON key.",
        "The CLI does not accept raw Google service-account JSON. Map the downloaded key into `serviceAccount.projectId`, `clientEmail`, `privateKey`, and optional `privateKeyId`.",
        "If you use OAuth instead, provide `accessToken`, `refreshToken`, and `expiresAt` with the BigQuery readonly scope.",
      ],
      exampleInput: {
        sourceKey: "bigquery_prod",
        credentials: {
          projectId: "analytics-project",
          serviceAccount: {
            projectId: "analytics-project",
            clientEmail: "onequery@analytics-project.iam.gserviceaccount.com",
            privateKey:
              "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
          },
        },
      },
    },
  },
  codex_app_server_api: {
    label: "Codex App Server API",
    credentialSchema: CodexAppServerApiCredentialsSchema,
    credentialType: "codex_app_server_api",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect the OpenAI-compatible Codex App Server API without exposing its API key to the caller.",
      steps: [
        "Run the local codex-app-server-api origin and expose it through a secure HTTPS tunnel or private network endpoint reachable from OneQuery.",
        "Set `apiBaseUrl` to the API origin, for example `https://codex-app-server-api.example.com`.",
        "Create or copy a codex-app-server-api key and store it in `apiKey`.",
        "Call native paths such as `/v1/models`, `/v1/responses`, and `/v1/chat/completions` through the Source API.",
      ],
      exampleInput: {
        sourceKey: "codex_app_server",
        credentials: {
          type: "codex_app_server_api",
          apiBaseUrl: "https://codex-app-server-api.example.com",
          apiKey: "sk-codex-app-server-key",
        },
      },
    },
  },
  cloudflare_d1: {
    label: "Cloudflare D1",
    credentialSchema: CloudflareD1CredentialsSchema,
    credentialType: "cloudflare_d1",
    connectable: true,
    analysisSource: true,
    queryInterface: true,
    sourceApiInterface: false,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "cloudflare_d1",
    publicCategory: "Warehouses",
    guide: {
      summary:
        "Connect Cloudflare D1 with an account ID, D1 database ID, and account-scoped API token.",
      steps: [
        "Copy the Cloudflare Account ID from the dashboard.",
        "Copy the D1 database ID from the target database settings.",
        "Create a Cloudflare API token that can query the target D1 database.",
        "Only include `apiBaseUrl` when you need a non-default Cloudflare API origin.",
      ],
      exampleInput: {
        sourceKey: "cloudflare_d1_prod",
        credentials: {
          accountId: "023e105f4ecef8ad9ca31a8372d0c353",
          databaseId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
          apiToken: "cloudflare_api_token",
        },
      },
    },
  },
  cloudflare_r2_sql: {
    label: "Cloudflare R2 SQL",
    credentialSchema: CloudflareR2SqlCredentialsSchema,
    credentialType: "cloudflare_r2_sql",
    connectable: true,
    analysisSource: true,
    queryInterface: true,
    sourceApiInterface: false,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Warehouses",
    guide: {
      summary:
        "Connect Cloudflare R2 SQL with an account ID, R2 bucket name, and API token for querying R2 Data Catalog Iceberg tables.",
      steps: [
        "Enable R2 Data Catalog for the bucket that owns the Iceberg tables OneQuery should query.",
        "Copy the Cloudflare Account ID and the R2 bucket name from the Cloudflare dashboard or Wrangler.",
        "Create a Cloudflare API token with R2 SQL read access plus R2 Data Catalog and R2 storage permissions for the target bucket.",
        "Only include `apiBaseUrl` when you need a non-default R2 SQL API origin.",
      ],
      exampleInput: {
        sourceKey: "cloudflare_r2_sql_prod",
        credentials: {
          accountId: "023e105f4ecef8ad9ca31a8372d0c353",
          bucketName: "analytics-events",
          apiToken: "cloudflare_r2_sql_token",
        },
      },
    },
  },
  laminar: {
    label: "Laminar",
    credentialSchema: LaminarCredentialsSchema,
    credentialType: "laminar",
    connectable: true,
    analysisSource: true,
    queryInterface: true,
    sourceApiInterface: false,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "laminar",
    publicCategory: "Observability",
    guide: {
      summary:
        "Connect Laminar with an API key and optional non-default base URL.",
      steps: [
        "Retrieve a Laminar API key with access to the target workspace.",
        "Only include `apiBaseUrl` when the account uses a non-default Laminar API host.",
      ],
      exampleInput: {
        sourceKey: "laminar_main",
        credentials: {
          apiKey: "laminar_api_key",
        },
      },
    },
  },
  motherduck: {
    label: "MotherDuck",
    credentialSchema: MotherDuckCredentialsSchema,
    credentialType: "motherduck",
    connectable: true,
    analysisSource: true,
    queryInterface: true,
    sourceApiInterface: false,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "database",
    publicCategory: "Warehouses",
    guide: {
      summary:
        "Connect MotherDuck through its PostgreSQL wire protocol endpoint with a service token.",
      steps: [
        "Create a MotherDuck service token with access to the target database.",
        "Use `md:` for the default database, or `md:database_name` for a specific MotherDuck database.",
        "Only override host, port, or username if MotherDuck documents a different endpoint for your environment.",
      ],
      exampleInput: {
        sourceKey: "motherduck_prod",
        credentials: {
          database: "md:",
          token: "motherduck_service_token",
        },
      },
    },
  },
  aws_athena_connector: {
    label: "AWS Athena Connector",
    credentialSchema: ConnectorCredentialsSchema,
    credentialType: "aws_athena_connector",
    connectable: true,
    analysisSource: true,
    queryInterface: true,
    sourceApiInterface: false,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "aws_athena_connector",
    publicCategory: "Warehouses",
    guide: {
      summary:
        "Connect an Athena connector already registered with this org in OneQuery.",
      steps: [
        "Retrieve the OneQuery connector ID for the Athena connector already linked to this org.",
        "Retrieve the Athena database name and optional workgroup override for the queries you want to run.",
      ],
      exampleInput: {
        sourceKey: "athena_main",
        credentials: {
          connectorId: "connector_01HXYZ",
          database: "analytics",
          workgroup: "primary",
        },
      },
    },
  },
  ga: {
    label: "Google Analytics",
    credentialSchema: GoogleAnalyticsCredentialsSchema,
    credentialType: "ga",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "google_service_account",
    googleOAuth: {
      credentialDefaults: { propertyId: "" },
      scopes: [GOOGLE_OAUTH_SCOPES.ANALYTICS_READONLY],
    },
    publicCategory: "Product analytics",
    guide: {
      summary:
        "Connect Google Analytics with either Google OAuth tokens or a Google Cloud service account JSON key.",
      steps: [
        "Retrieve the GA4 `propertyId` from `Admin > Property details`.",
        "For the live service-account flow, create a Google Cloud service account, create a JSON key, then add that service-account email as a GA4 Viewer.",
        "The CLI does not accept raw Google service-account JSON. Map the downloaded key into `serviceAccount.projectId`, `clientEmail`, `privateKey`, and optional `privateKeyId`.",
        "If you use OAuth instead, provide `accessToken`, `refreshToken`, and `expiresAt` with the Analytics readonly scope.",
      ],
      exampleInput: {
        sourceKey: "ga_marketing",
        credentials: {
          propertyId: "123456789",
          serviceAccount: {
            projectId: "analytics-project",
            clientEmail: "onequery@analytics-project.iam.gserviceaccount.com",
            privateKey:
              "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
          },
        },
      },
    },
  },
  youtube_analytics: {
    label: "YouTube Analytics",
    credentialSchema: YouTubeAnalyticsCredentialsSchema,
    credentialType: "youtube_analytics",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "google_oauth",
    googleOAuth: {
      credentialDefaults: {},
      scopes: [
        GOOGLE_OAUTH_SCOPES.YOUTUBE_READONLY,
        GOOGLE_OAUTH_SCOPES.YOUTUBE_ANALYTICS_READONLY,
      ],
    },
    publicCategory: "Product analytics",
    guide: {
      summary:
        "Connect YouTube Analytics with Google OAuth tokens that can read YouTube Analytics reports.",
      steps: [
        "Enable the YouTube Analytics API in the Google Cloud project used for OAuth.",
        "Authorize a Google account that owns or manages the YouTube channel or content owner data you need to analyze.",
        "Use the `https://www.googleapis.com/auth/youtube.readonly` and `https://www.googleapis.com/auth/yt-analytics.readonly` scopes for non-monetary metrics. Revenue and ad performance metrics require `https://www.googleapis.com/auth/yt-analytics-monetary.readonly`.",
        "Call `/reports` through Source API with query params such as `ids`, `startDate`, `endDate`, `metrics`, `dimensions`, and `filters`.",
      ],
      exampleInput: {
        sourceKey: "youtube_analytics",
        credentials: {
          type: "youtube_analytics",
          authType: "oauth",
          accessToken: "ya29...",
          refreshToken: "1//...",
          expiresAt: 1_798_761_600_000,
        },
      },
    },
  },
  amplitude: {
    label: "Amplitude",
    credentialSchema: AmplitudeCredentialsSchema,
    credentialType: "amplitude",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "amplitude",
    publicCategory: "Product analytics",
    guide: {
      summary:
        "Connect Amplitude with a project API key, secret key, and region.",
      steps: [
        "In Amplitude Settings, open `Projects`, choose the target project, and go to its `General` page.",
        "Copy an active API key and the project Secret Key.",
        "Set `region` to `eu` only for Amplitude EU projects; otherwise use `us`.",
      ],
      exampleInput: {
        sourceKey: "amplitude_product",
        credentials: {
          apiKey: "amplitude_api_key",
          secretKey: "amplitude_secret",
          region: "us",
        },
      },
    },
  },
  mixpanel: {
    label: "Mixpanel",
    credentialSchema: MixpanelCredentialsSchema,
    credentialType: "mixpanel",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "mixpanel",
    publicCategory: "Product analytics",
    guide: {
      summary:
        "Connect Mixpanel with an org-level service account, project ID, and region.",
      steps: [
        "Create or retrieve a Mixpanel service account with access to the target project.",
        "Copy the service account Username and Secret.",
        "Copy the Project ID and map Data Residency to `region`: `US` -> `us`, `EU` -> `eu`, `India` -> `in`.",
      ],
      exampleInput: {
        sourceKey: "mixpanel_growth",
        credentials: {
          projectId: "12345",
          username: "service-account",
          secret: "service-account-secret",
          region: "us",
        },
      },
    },
  },
  posthog: {
    label: "PostHog",
    credentialSchema: PostHogCredentialsSchema,
    credentialType: "posthog",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "posthog",
    publicCategory: "Product analytics",
    guide: {
      summary:
        "Connect PostHog with the PostHog app host URL, a personal API key, and project ID.",
      steps: [
        "Open the PostHog project you want to connect, then go to `Settings -> Project -> General` and copy the `Project ID` from the `Project token & ID` section.",
        "Use the PostHog app origin as `credentials.hostUrl`: `https://us.posthog.com` for US Cloud, `https://eu.posthog.com` for EU Cloud, or your self-hosted base URL. Do not use the SDK `api_host` value such as `https://us.i.posthog.com`.",
        "Go to `Settings -> Account -> Personal API keys`, create a personal API key, and make sure `Organization & project access` includes the project you plan to connect.",
        "Grant at least `Read` access to `Project` and `Query`, then copy the secret immediately into `credentials.personalApiKey`. PostHog may only show the full key once.",
        "Use the canonical host URL without a trailing slash when possible; the server still normalizes extra trailing slashes.",
      ],
      exampleInput: {
        sourceKey: "posthog_main",
        credentials: {
          hostUrl: "https://us.posthog.com",
          personalApiKey: "phx_personal_key",
          projectId: "12345",
        },
      },
    },
  },
  sentry: {
    label: "Sentry",
    credentialSchema: SentryCredentialsSchema,
    credentialType: "sentry",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "sentry",
    publicCategory: "Observability",
    guide: {
      summary:
        "Connect Sentry with a Personal Token, organization slug, optional project slug, and optional self-hosted API base URL.",
      steps: [
        "Create a Sentry Personal Token with organization and project read scopes.",
        "Copy the Organization Slug and optional Project Slug.",
        "Leave `credentials.apiBaseUrl` empty for Sentry Cloud. Set it only for self-hosted Sentry.",
      ],
      exampleInput: {
        sourceKey: "sentry_main",
        credentials: {
          authToken: "sntrys_...",
          organizationSlug: "your-org-slug",
          projectSlug: "your-project-slug",
        },
      },
    },
  },
  github: {
    label: "GitHub",
    credentialSchema: GitHubCredentialsSchema,
    credentialType: "github",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "github",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect GitHub with a fine-grained personal access token and optional repository or installation scoping.",
      steps: [
        "Create a fine-grained personal access token for the correct resource owner.",
        "Grant read-only repository permissions for Contents, Issues, Pull requests, and Metadata.",
        "Copy the token into `credentials.accessToken`; optionally include `installationId` and `repositories`.",
      ],
      exampleInput: {
        sourceKey: "github_main",
        credentials: {
          accessToken: "github_pat_or_installation_token",
          repositories: ["octocat/Hello-World"],
        },
      },
    },
  },
  figma: {
    label: "Figma",
    credentialSchema: FigmaCredentialsSchema,
    credentialType: "figma",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect Figma with a personal access token for read-only REST API and grouped design-context access.",
      steps: [
        "Create a Figma personal access token with the `file_content:read` scope.",
        "Add `file_variables:read` when grouped design-context requests should include local variable definitions.",
        "Copy the token into `credentials.personalAccessToken`.",
        "Use `fetch_api` for read-only REST paths or `prepare_design_context` to bundle nodes, renders, image fills, and optional variables for selected frames.",
      ],
      exampleInput: {
        sourceKey: "figma_product",
        credentials: {
          personalAccessToken: "figd_personal_access_token",
        },
      },
    },
  },
  airtable: {
    label: "Airtable",
    credentialSchema: AirtableCredentialsSchema,
    credentialType: "airtable",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Productivity",
    guide: {
      summary:
        "Connect Airtable with a Personal Access Token and optional default base ID.",
      steps: [
        "Create an Airtable Personal Access Token with scopes and base access for the records or metadata endpoints OneQuery should call.",
        "Copy the token into `credentials.personalAccessToken`.",
        "Optionally include `baseId` so source API selectors like `/TableName` expand to `/v0/<baseId>/TableName`.",
      ],
      exampleInput: {
        sourceKey: "airtable_ops",
        credentials: {
          personalAccessToken: "pat...",
          baseId: "appXXXXXXXXXXXXXX",
        },
      },
    },
  },
  discord: {
    label: "Discord",
    credentialSchema: DiscordCredentialsSchema,
    credentialType: "discord",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect Discord with a bot token or OAuth bearer token for Discord REST API access.",
      steps: [
        "Create a Discord application and bot in the Developer Portal, or provide an OAuth token with the scopes required by the endpoints you will call.",
        "Copy the token into `credentials.token`; leave `authScheme` as `bot` for bot tokens or set it to `bearer` for OAuth access tokens.",
        "Optionally include `guildId` so selectors like `/channels` expand to `/guilds/<guildId>/channels`.",
      ],
      exampleInput: {
        sourceKey: "discord_workspace",
        credentials: {
          token: "discord_bot_token",
          authScheme: "bot",
          guildId: "123456789012345678",
        },
      },
    },
  },
  slack: {
    label: "Slack",
    credentialSchema: SlackCredentialsSchema,
    credentialType: "slack",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "slack_oauth",
    publicCategory: "Productivity",
    guide: {
      summary:
        "Connect Slack so agents can read channel and thread history and send messages where the installed app has access.",
      steps: [
        "Authorize or install the Slack app for the target workspace.",
        "Grant chat:write if agents should send messages.",
        "Invite the app to any private channels the source should analyze or message.",
        "Use channel IDs or channel names when reading Slack history or sending messages.",
      ],
      exampleInput: {
        sourceKey: "slack_workspace",
        credentials: {
          type: "slack",
          botToken: "xoxb-...",
          botUserId: "U1234567890",
          teamId: "T1234567890",
          teamName: "Acme",
          botScopes: ["channels:read", "channels:history", "chat:write"],
        },
      },
    },
  },
  cal: {
    label: "Cal.com",
    credentialSchema: CalCredentialsSchema,
    credentialType: "cal",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Productivity",
    guide: {
      summary:
        "Connect Cal.com API v2 with an API key or compatible bearer token.",
      steps: [
        "Create a Cal.com API key from Settings > Security, or use a managed-user/OAuth access token for endpoints that require it.",
        "Copy the token into `credentials.apiKey`.",
        "Keep `apiVersion` at `2026-05-01` unless Cal.com documents a newer required `cal-api-version` value for the endpoint.",
      ],
      exampleInput: {
        sourceKey: "cal_bookings",
        credentials: {
          apiKey: "cal_...",
          apiVersion: "2026-05-01",
        },
      },
    },
  },
  granola: {
    label: "Granola",
    credentialSchema: GranolaCredentialsSchema,
    credentialType: "granola",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Productivity",
    guide: {
      summary:
        "Connect Granola with an API key that has access to the note scopes you want to query.",
      steps: [
        "Create a Granola API key from the desktop app under Settings > Connectors > API keys.",
        "Choose the Personal notes and/or Public notes scopes needed for OneQuery.",
        "Copy the generated key into `credentials.apiKey`.",
      ],
      exampleInput: {
        sourceKey: "granola_notes",
        credentials: {
          apiKey: "grn_...",
        },
      },
    },
  },
  google_search_console: {
    label: "Google Search Console",
    credentialSchema: GoogleSearchConsoleCredentialsSchema,
    credentialType: "google_search_console",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "google_oauth",
    googleOAuth: {
      credentialDefaults: {},
      scopes: [GOOGLE_OAUTH_SCOPES.WEBMASTERS_READONLY],
    },
    publicCategory: "Marketing",
    guide: {
      summary:
        "Connect Google Search Console with Google OAuth or an OAuth access token and optional default site URL.",
      steps: [
        "Confirm the Search Console property is visible to the Google account that will authorize OneQuery.",
        "Use the dashboard `Connect with Google` flow, or create an OAuth 2.0 access token with the `https://www.googleapis.com/auth/webmasters.readonly` scope for CLI/JSON connections.",
        "For CLI/JSON connections, copy the token into `credentials.accessToken`; optionally include the exact Search Console property string in `credentials.siteUrl` so selector `/searchAnalytics/query` expands to `/sites/<siteUrl>/searchAnalytics/query`.",
      ],
      exampleInput: {
        sourceKey: "gsc_site",
        credentials: {
          accessToken: "ya29...",
          siteUrl: "sc-domain:example.com",
        },
      },
    },
  },
  confluence: {
    label: "Confluence",
    credentialSchema: ConfluenceCredentialsSchema,
    credentialType: "confluence",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect Confluence Cloud with an Atlassian account email and API token.",
      steps: [
        "Create an Atlassian API token for the account that can read the Confluence site.",
        "Copy the Atlassian account email into `credentials.email` and the token into `credentials.apiToken`.",
        "Set `siteUrl` to the Atlassian Cloud site origin, for example `https://example.atlassian.net`.",
      ],
      exampleInput: {
        sourceKey: "confluence_docs",
        credentials: {
          siteUrl: "https://example.atlassian.net",
          email: "reader@example.com",
          apiToken: "atlassian_api_token",
        },
      },
    },
  },
  jam: {
    label: "Jam",
    credentialSchema: JamCredentialsSchema,
    credentialType: "jam",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: true,
    dashboardConnectable: true,
    dashboardCredentialForm: "jam",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect a Jam workspace through Jam MCP with a read-only personal access token.",
      steps: [
        "Open Jam workspace Settings, choose MCP, and create a personal access token for this connection.",
        "Grant only the `mcp:read` scope so OneQuery can inspect Jams without moving them or adding comments.",
        "Copy the token immediately and store it in `credentials.accessToken`; Jam does not show the token again after creation.",
      ],
      exampleInput: {
        sourceKey: "jam_workspace",
        credentials: {
          accessToken: "jam_pat_...",
        },
      },
    },
  },
  amazon_ads: {
    label: "Amazon Ads",
    credentialSchema: AmazonAdsCredentialsSchema,
    credentialType: "amazon_ads",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Marketing",
    guide: {
      summary:
        "Connect Amazon Ads with a Login with Amazon access token, client ID, region, and optional profile ID.",
      steps: [
        "Create or refresh a Login with Amazon access token authorized for the Amazon Ads account.",
        "Copy the Amazon Ads API client ID into `credentials.clientId` and the access token into `credentials.accessToken`.",
        "Set `region` to `na`, `eu`, or `fe`; optionally include `profileId` so OneQuery sends the `Amazon-Advertising-API-Scope` header.",
      ],
      exampleInput: {
        sourceKey: "amazon_ads_na",
        credentials: {
          accessToken: "Atza|...",
          clientId: "amzn1.application-oa2-client...",
          profileId: "1234567890",
          region: "na",
        },
      },
    },
  },
  linkedin_ads: {
    label: "LinkedIn Ads",
    credentialSchema: LinkedInAdsCredentialsSchema,
    credentialType: "linkedin_ads",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Marketing",
    guide: {
      summary:
        "Connect LinkedIn Ads with a Marketing API OAuth access token and version header.",
      steps: [
        "Create or obtain a LinkedIn Marketing API OAuth access token with access to the ad accounts OneQuery should query.",
        "Use a supported Marketing API version as `credentials.apiVersion` in `YYYYMM` format; OneQuery defaults to `202605`.",
        "Only include `apiBaseUrl` when you need a non-default LinkedIn-compatible API origin.",
      ],
      exampleInput: {
        sourceKey: "linkedin_ads_main",
        credentials: {
          accessToken: "linkedin_oauth_access_token",
          apiVersion: "202605",
        },
      },
    },
  },
  tiktok_marketing: {
    label: "TikTok Marketing",
    credentialSchema: TikTokMarketingCredentialsSchema,
    credentialType: "tiktok_marketing",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Marketing",
    guide: {
      summary:
        "Connect TikTok Marketing API with an API for Business access token.",
      steps: [
        "Create or obtain a TikTok API for Business access token authorized for the advertiser accounts OneQuery should query.",
        "Optionally include the common advertiser ID as `credentials.advertiserId`; endpoint calls can still pass advertiser IDs in request params.",
        "Only include `apiBaseUrl` when you need a non-default TikTok Business API origin.",
      ],
      exampleInput: {
        sourceKey: "tiktok_marketing_main",
        credentials: {
          accessToken: "tiktok_access_token",
          advertiserId: "1234567890",
        },
      },
    },
  },
  sendgrid: {
    label: "SendGrid",
    credentialSchema: SendGridCredentialsSchema,
    credentialType: "sendgrid",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Marketing",
    guide: {
      summary: "Connect SendGrid with a v3 Web API key.",
      steps: [
        "Create a SendGrid API key with the scopes required for the account, email, or marketing endpoints OneQuery should call.",
        "Copy the key into `credentials.apiKey`.",
        "Only include `apiBaseUrl` when you need a non-default SendGrid-compatible API origin.",
      ],
      exampleInput: {
        sourceKey: "sendgrid_main",
        credentials: {
          apiKey: "SG.xxxxx",
        },
      },
    },
  },
  jira: {
    label: "Jira",
    credentialSchema: JiraCredentialsSchema,
    credentialType: "jira",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect Jira Cloud with an Atlassian account email and API token.",
      steps: [
        "Create an Atlassian API token for the account that can read the Jira site.",
        "Copy the Atlassian account email into `credentials.email` and the token into `credentials.apiToken`.",
        "Set `siteUrl` to the Atlassian Cloud site origin, for example `https://example.atlassian.net`.",
      ],
      exampleInput: {
        sourceKey: "jira_projects",
        credentials: {
          siteUrl: "https://example.atlassian.net",
          email: "reader@example.com",
          apiToken: "atlassian_api_token",
        },
      },
    },
  },
  vercel: {
    label: "Vercel",
    credentialSchema: VercelCredentialsSchema,
    credentialType: "vercel",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect Vercel with an API token for deployments, projects, teams, and runtime observability endpoints.",
      steps: [
        "Create a Vercel API token with read access to the account or team OneQuery should inspect.",
        "Copy the token into `credentials.apiToken`.",
        "Use `params[teamId]` in Source API requests when calling team-scoped Vercel endpoints.",
        "Only include `apiBaseUrl` when you need a non-default Vercel-compatible API origin.",
      ],
      exampleInput: {
        sourceKey: "vercel_main",
        credentials: {
          type: "vercel",
          apiToken: "vercel_api_token",
        },
      },
    },
  },
  e2b: {
    label: "E2B",
    credentialSchema: E2BCredentialsSchema,
    credentialType: "e2b",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect E2B with a team API key to inspect sandbox state, logs, metrics, and lifecycle events through read-only Source API calls.",
      steps: [
        "Create or copy an E2B team API key from the E2B dashboard.",
        "Copy the key into `credentials.apiKey`.",
        "Use the default API base URL unless you need a non-default E2B-compatible API origin.",
        "Keep this source read-only for debugging; sandbox lifecycle mutations are intentionally out of scope.",
      ],
      exampleInput: {
        sourceKey: "e2b_main",
        credentials: {
          type: "e2b",
          apiKey: "e2b_api_key",
        },
      },
    },
  },
  hermes: {
    label: "Hermes Agent",
    credentialSchema: HermesCredentialsSchema,
    credentialType: "hermes",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect the native Hermes Agent HTTP API without exposing its API key to the caller.",
      steps: [
        "Enable the Hermes Agent API server with `API_SERVER_ENABLED=true` and a strong `API_SERVER_KEY`.",
        "Expose the local Hermes API server through a secure HTTPS tunnel or private network endpoint reachable from OneQuery.",
        "Set `apiBaseUrl` to the Hermes API origin, for example a Cloudflare Tunnel URL.",
        "Copy the Hermes `API_SERVER_KEY` into `apiKey`.",
        "Call native paths such as `/v1/models`, `/v1/responses`, `/v1/runs`, `/api/sessions`, and `/api/jobs` through the Source API.",
      ],
      exampleInput: {
        sourceKey: "hermes_main",
        credentials: {
          type: "hermes",
          apiBaseUrl: "https://hermes.example.com",
          apiKey: "hermes_api_key",
        },
      },
    },
  },
  onepassword: {
    label: "1Password",
    credentialSchema: OnePasswordCredentialsSchema,
    credentialType: "onepassword",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect 1Password with a Service Account token for read-only vault, item, and secret reference access.",
      steps: [
        "Create a 1Password Service Account and grant it read-only access to the target vaults.",
        "Copy the Service Account token into `credentials.serviceAccountToken`.",
        "Set `credentials.authMethod` to `service_account`.",
        "Source API calls are read-only; use operations such as `list_vaults`, `list_items`, `get_item`, and `resolve_secret`.",
        'Existing Connect Server credentials remain supported with `authMethod: "connect"`, `apiBaseUrl`, and `accessToken`.',
      ],
      exampleInput: {
        sourceKey: "onepassword_main",
        credentials: {
          type: "onepassword",
          authMethod: "service_account",
          serviceAccountToken: "ops_service_account_token",
        },
      },
    },
  },
  microsoft_clarity: {
    label: "Microsoft Clarity",
    credentialSchema: MicrosoftClarityCredentialsSchema,
    credentialType: "microsoft_clarity",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Product analytics",
    guide: {
      summary:
        "Connect Microsoft Clarity with a project Data Export API token.",
      steps: [
        "Open the target Clarity project and generate a Data Export API token from Settings > Data Export.",
        "Copy the token into `credentials.apiToken`.",
        "Only include `apiBaseUrl` when you need a non-default Clarity-compatible export API origin.",
      ],
      exampleInput: {
        sourceKey: "microsoft_clarity_main",
        credentials: {
          type: "microsoft_clarity",
          apiToken: "clarity_api_token",
        },
      },
    },
  },
  linear: {
    label: "Linear",
    credentialSchema: LinearCredentialsSchema,
    credentialType: "linear",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "linear",
    publicCategory: "Developer workflow",
    guide: {
      summary:
        "Connect Linear with an API key and choose whether agents can only receive mentions, read issues, or read and create issues.",
      steps: [
        "Create a Linear API key for the workspace you want OneQuery to access.",
        "Choose `mention`, `read`, or `read_write` in `credentials.accessMode`.",
        "Optionally set `credentials.graphqlAllowList` to enable raw `graphql_request` for selected Linear GraphQL root fields.",
        "Use `mention` when OneQuery should keep the connection metadata but must not expose Linear issue reads or writes through Source API.",
      ],
      exampleInput: {
        sourceKey: "linear_main",
        credentials: {
          accessMode: "read",
          apiKey: "lin_api_key",
          graphqlAllowList: ["issue", "issues"],
        },
      },
    },
  },
  cloudflare_workers_observability: {
    label: "Cloudflare Workers Observability",
    credentialSchema: CloudflareWorkersObservabilityCredentialsSchema,
    credentialType: "cloudflare_workers_observability",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "cloudflare_workers_observability",
    publicCategory: "Observability",
    guide: {
      summary:
        "Connect Cloudflare Workers Observability with an account-scoped API token and account ID.",
      steps: [
        "Enable Workers Logs in the target Worker's Wrangler configuration and redeploy so Cloudflare stores telemetry for the account.",
        "Create a Cloudflare API token with the Workers Observability permission required by the telemetry API.",
        "Copy the Cloudflare Account ID from the dashboard and pass it as `credentials.accountId`.",
        "Optionally include `scriptName` to document the default Worker service this source usually queries.",
      ],
      exampleInput: {
        sourceKey: "cloudflare_workers",
        credentials: {
          type: "cloudflare_workers_observability",
          accountId: "023e105f4ecef8ad9ca31a8372d0c353",
          apiToken: "cloudflare_api_token",
          scriptName: "api-production",
        },
      },
    },
  },
  cloudflare_web_analytics: {
    label: "Cloudflare Web Analytics",
    credentialSchema: CloudflareWebAnalyticsCredentialsSchema,
    credentialType: "cloudflare_web_analytics",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: true,
    testable: false,
    dashboardConnectable: true,
    dashboardCredentialForm: "json",
    publicCategory: "Product analytics",
    guide: {
      summary:
        "Connect Cloudflare Web Analytics with an account-scoped API token, account ID, and optional site tag.",
      steps: [
        "Copy the Cloudflare Account ID from the dashboard.",
        "Create a Cloudflare API token that can read Analytics GraphQL data and Web Analytics RUM site configuration for the account.",
        "Optionally copy the Web Analytics site tag from the Web Analytics site details; Source API examples use it as the default GraphQL filter.",
        "Use Cloudflare Workers Observability as a separate source when you need Worker telemetry logs. It uses a different API surface even when it shares the same account and token.",
      ],
      exampleInput: {
        sourceKey: "cloudflare_web_analytics",
        credentials: {
          type: "cloudflare_web_analytics",
          accountId: "023e105f4ecef8ad9ca31a8372d0c353",
          apiToken: "cloudflare_api_token",
          siteTag: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        },
      },
    },
  },
} as const satisfies Record<string, SourceProviderDefinition>;

export type SourceProviderId = keyof typeof SOURCE_PROVIDER_REGISTRY;

export const SOURCE_PROVIDER_IDS = Object.keys(
  SOURCE_PROVIDER_REGISTRY
) as SourceProviderId[];

export const ANALYSIS_SOURCE_PROVIDER_TYPES = SOURCE_PROVIDER_IDS.filter(
  (provider) => SOURCE_PROVIDER_REGISTRY[provider].analysisSource
) as SourceProviderId[];

export const TESTABLE_PROVIDER_TYPES = SOURCE_PROVIDER_IDS.filter(
  (provider) => SOURCE_PROVIDER_REGISTRY[provider].testable
) as SourceProviderId[];

export function isSourceProviderId(value: string): value is SourceProviderId {
  return Object.hasOwn(SOURCE_PROVIDER_REGISTRY, value);
}

export function getSourceProviderDefinition(provider: string) {
  if (!isSourceProviderId(provider)) {
    return null;
  }
  return SOURCE_PROVIDER_REGISTRY[provider];
}

export type GoogleOAuthSourceProviderConfig = {
  credentialDefaults: Record<string, unknown>;
  credentialType: string;
  label: string;
  provider: SourceProviderId;
  scopes: string[];
};

export function getGoogleOAuthSourceProviderConfig(
  provider: string
): GoogleOAuthSourceProviderConfig | null {
  if (!isSourceProviderId(provider)) {
    return null;
  }

  const definition: SourceProviderDefinition =
    SOURCE_PROVIDER_REGISTRY[provider];
  if (!definition.googleOAuth) {
    return null;
  }

  return {
    credentialDefaults: { ...definition.googleOAuth.credentialDefaults },
    credentialType: definition.credentialType,
    label: definition.label,
    provider,
    scopes: [...definition.googleOAuth.scopes],
  };
}

export const GOOGLE_OAUTH_SOURCE_PROVIDER_IDS = SOURCE_PROVIDER_IDS.filter(
  (provider) => getGoogleOAuthSourceProviderConfig(provider) !== null
);

export function isTestableProviderType(
  provider: SourceProviderId
): provider is (typeof TESTABLE_PROVIDER_TYPES)[number] {
  return SOURCE_PROVIDER_REGISTRY[provider].testable;
}

export function doesSourceProviderMatchCredentials(input: {
  provider: SourceProviderId;
  credentialsType: string;
}): boolean {
  return (
    SOURCE_PROVIDER_REGISTRY[input.provider].credentialType ===
    input.credentialsType
  );
}

export type SourceProviderCredentialsParseError =
  | {
      code: "unsupported_provider";
      provider: string;
    }
  | {
      code: "invalid_credentials";
      error: z.ZodError;
    }
  | {
      code: "provider_credentials_mismatch";
      credentialsType: string;
      provider: SourceProviderId;
    };

export type SourceProviderCredentialsParseResult =
  | {
      success: true;
      data: {
        credentials: Credentials;
        provider: SourceProviderId;
      };
    }
  | {
      success: false;
      error: SourceProviderCredentialsParseError;
    };

function isCredentialInputRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses provider credentials at the OneQuery boundary.
 *
 * The provider registry is authoritative for the credential discriminator and
 * provider-specific defaults, so callers do not need to duplicate either.
 */
export function safeParseSourceProviderCredentials(input: {
  provider: string;
  credentials: unknown;
}): SourceProviderCredentialsParseResult {
  if (!isSourceProviderId(input.provider)) {
    return {
      success: false,
      error: {
        code: "unsupported_provider",
        provider: input.provider,
      },
    };
  }

  const provider = input.provider;
  const definition = SOURCE_PROVIDER_REGISTRY[provider];
  let normalizedCredentials = input.credentials;

  if (isCredentialInputRecord(input.credentials)) {
    let credentialRecord: Record<string, unknown> = input.credentials;

    if (
      (definition.credentialType === "bigquery" ||
        definition.credentialType === "ga") &&
      "serviceAccount" in credentialRecord &&
      !("authType" in credentialRecord)
    ) {
      credentialRecord = {
        ...credentialRecord,
        authType: "service_account",
      };
    }

    if (
      provider === "supabase" &&
      definition.credentialType === "postgres" &&
      !("sslMode" in credentialRecord)
    ) {
      credentialRecord = {
        ...credentialRecord,
        sslMode: "require",
      };
    }

    normalizedCredentials = {
      ...credentialRecord,
      type: definition.credentialType,
    };
  }

  const parsed = definition.credentialSchema.safeParse(normalizedCredentials);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "invalid_credentials",
        error: parsed.error,
      },
    };
  }

  if (
    !doesSourceProviderMatchCredentials({
      credentialsType: parsed.data.type,
      provider,
    })
  ) {
    return {
      success: false,
      error: {
        code: "provider_credentials_mismatch",
        credentialsType: parsed.data.type,
        provider,
      },
    };
  }

  return {
    success: true,
    data: {
      credentials: parsed.data as Credentials,
      provider,
    },
  };
}

export type PublicSourceProvider = {
  id: SourceProviderId;
  label: string;
  publicCategory: SourceProviderPublicCategory;
  connectable: boolean;
  dashboardConnectable: boolean;
  dashboardCredentialForm: string;
  testable: boolean;
  interfaces: ("query" | "api")[];
  credentialType: string;
  credentialExample: Record<string, unknown>;
  guideSummary: string;
  guideSteps: string[];
};

export function listPublicSourceProviders(): PublicSourceProvider[] {
  return SOURCE_PROVIDER_IDS.map((id) => {
    const provider = SOURCE_PROVIDER_REGISTRY[id];
    return {
      id,
      label: provider.label,
      publicCategory: provider.publicCategory,
      connectable: provider.connectable,
      dashboardConnectable: provider.dashboardConnectable,
      dashboardCredentialForm: provider.dashboardCredentialForm,
      testable: provider.testable,
      interfaces: [
        ...(provider.queryInterface ? ["query" as const] : []),
        ...(provider.sourceApiInterface ? ["api" as const] : []),
      ],
      credentialType: provider.credentialType,
      credentialExample: provider.guide.exampleInput.credentials,
      guideSummary: provider.guide.summary,
      guideSteps: [...provider.guide.steps],
    };
  });
}
