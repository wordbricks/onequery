import type { z } from "zod";

import {
  AmplitudeCredentialsSchema,
  BigQueryCredentialsSchema,
  CloudflareD1CredentialsSchema,
  CloudflareWorkersObservabilityCredentialsSchema,
  ConnectorCredentialsSchema,
  GitHubCredentialsSchema,
  GoogleAnalyticsCredentialsSchema,
  LaminarCredentialsSchema,
  LinearCredentialsSchema,
  MixpanelCredentialsSchema,
  MongoDBCredentialsSchema,
  MySQLCredentialsSchema,
  PostgresCredentialsSchema,
  PostHogCredentialsSchema,
  SentryCredentialsSchema,
  SnowflakeCredentialsSchema,
} from "./credentials";

type ProviderCredentialSchema = z.ZodType<{ type: string }>;

type SourceProviderGuide = {
  summary: string;
  steps: readonly string[];
  exampleInput: {
    sourceKey: string;
    credentials: Record<string, unknown>;
  };
};

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
  guide: SourceProviderGuide;
};

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
    guide: {
      summary:
        "Connect PostHog with the PostHog app host URL, a personal API key, and project ID.",
      steps: [
        "Open the PostHog project settings and copy the Project ID.",
        "Use the PostHog app origin as `credentials.hostUrl`.",
        "Create a personal API key with project read access and copy it into `credentials.personalApiKey`.",
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
  linear: {
    label: "Linear",
    credentialSchema: LinearCredentialsSchema,
    credentialType: "linear",
    connectable: true,
    analysisSource: true,
    queryInterface: false,
    sourceApiInterface: false,
    testable: false,
    dashboardConnectable: false,
    dashboardCredentialForm: "json",
    guide: {
      summary:
        "Connect Linear with either an API key or a full OAuth token bundle.",
      steps: [
        "Choose either the API key shape (`apiKey`) or the OAuth shape (`accessToken` plus `linearOrganizationId`).",
        "If you use OAuth, keep the refresh metadata so the server can keep the connection valid over time.",
      ],
      exampleInput: {
        sourceKey: "linear_main",
        credentials: {
          apiKey: "lin_api_key",
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
          accountId: "023e105f4ecef8ad9ca31a8372d0c353",
          apiToken: "cloudflare_api_token",
          scriptName: "api-production",
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

export type PublicSourceProvider = {
  id: SourceProviderId;
  label: string;
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
