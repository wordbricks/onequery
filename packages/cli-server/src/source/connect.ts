import type { ProviderType } from "@onequery/db/server";

import {
  buildCliSourceConnectCommand,
  buildCliSourceShowCommand,
} from "../cli-defaults";
import type { CliSourceRecord } from "../domain/workflows";

type SourceConnectProviderGuide = {
  provider: ProviderType;
  summary: string;
  steps: string[];
  exampleInput: Record<string, unknown>;
};
const SOURCE_CONNECT_PROVIDERS: SourceConnectProviderGuide[] = [
  {
    provider: "postgres",
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
  {
    provider: "supabase",
    summary:
      "Connect Supabase with the session pooler host, database, and login credentials over the Postgres wire protocol.",
    steps: [
      "Open the Supabase Connect panel and retrieve the Session pooler host, database name, username, and password.",
      "Use the Supabase provider with the Postgres connection fields shown below. The CLI maps those fields onto the typed Supabase wire shape directly.",
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
  {
    provider: "mysql",
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
  {
    provider: "mongodb",
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
  {
    provider: "bigquery",
    summary:
      "Connect BigQuery with either Google OAuth tokens or a Google Cloud service account JSON key.",
    steps: [
      "Retrieve the Google Cloud `projectId` that owns the datasets OneQuery should query.",
      "For the live service-account flow, create a Google Cloud service account in that project, grant `BigQuery Data Viewer` and `BigQuery Job User`, then create a JSON key from `Keys > Add key > Create new key > JSON`.",
      "The CLI does not accept raw Google service-account JSON. Map the downloaded key into `serviceAccount.projectId`, `clientEmail`, `privateKey`, and optional `privateKeyId`.",
      "OneQuery tests BigQuery by running `SELECT 1 AS onequery_connection_test`, so the credential must be able to start jobs and read datasets in the target project.",
      "If you use OAuth instead, provide `accessToken`, `refreshToken`, and `expiresAt` with the `https://www.googleapis.com/auth/bigquery.readonly` scope.",
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
  {
    provider: "laminar",
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
  {
    provider: "aws_athena_connector",
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
  {
    provider: "ga",
    summary:
      "Connect Google Analytics with either Google OAuth tokens or a Google Cloud service account JSON key.",
    steps: [
      "Retrieve the GA4 `propertyId` from `Admin > Property details`. OneQuery accepts either plain digits such as `123456789` or the prefixed form `properties/123456789`.",
      "For the live service-account flow, create a Google Cloud service account, create a JSON key, then in GA4 `Admin > Property access management` add that service-account email as a `Viewer` with no extra data restrictions checked.",
      "The CLI does not accept raw Google service-account JSON. Map the downloaded key into `serviceAccount.projectId`, `clientEmail`, `privateKey`, and optional `privateKeyId`.",
      "OneQuery tests GA by calling `runReport` for the `activeUsers` metric, so the service account only needs read access to the target property.",
      "If you use OAuth instead, provide `accessToken`, `refreshToken`, and `expiresAt` with the `https://www.googleapis.com/auth/analytics.readonly` scope.",
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
  {
    provider: "amplitude",
    summary:
      "Connect Amplitude with a project API key, secret key, and region.",
    steps: [
      "In Amplitude Settings, open `Projects`, choose the target project, and go to its `General` page.",
      "In the `Project Details` card, click `Show` next to `Secret Key` and copy that value into `credentials.secretKey`.",
      "Click `Manage` next to `API Key`, then on `API and Secret Keys` copy an active API key for that project or click `Generate API Key` if you need a new one. Use that value as `credentials.apiKey`.",
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
  {
    provider: "mixpanel",
    summary:
      "Connect Mixpanel with an org-level service account, project ID, and region.",
    steps: [
      "In Mixpanel Settings, open `Org` -> `Service Accounts`, click `Add Service Account`, keep `Organization Role` set to `Member`, select the target project, and keep `Project Role` set to `Consumer`.",
      "Copy the one-time `Username` and `Secret` into `credentials.username` and `credentials.secret`. If the secret is exposed, delete the service account or rotate it before using it again.",
      "Open Settings -> `Project` -> `Overview`, copy `Project ID`, and map `Data Residency` to `region`: `US` -> `us`, `EU` -> `eu`, `India` -> `in`.",
      "Leave `workspaceId` unset unless you already know your Mixpanel setup requires a specific workspace or data view override.",
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
  {
    provider: "posthog",
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
  {
    provider: "sentry",
    summary:
      "Connect Sentry with a Personal Token, organization slug, optional project slug, and optional self-hosted API base URL.",
    steps: [
      "Open `https://sentry.io/settings/account/api/auth-tokens/`, click `Create New Token`, and use the live Sentry Personal Token flow.",
      "Set `Project = Read` and `Organization = Read`. If you will set `projectSlug` or want project event access, also set `Issue & Event = Read`. Sentry previews these as `project:read`, `organization:read`, and `event:read`.",
      "Copy the token immediately after creation and pass it as `credentials.authToken`. Sentry shows the token value only once.",
      "Read `Organization Slug` from Settings > Organization > General and pass it as `credentials.organizationSlug`.",
      "Optional: read `Slug` from Settings > Projects > <project> > General and pass it as `credentials.projectSlug`. When `projectSlug` is present, OneQuery validates `/projects/{organizationSlug}/{projectSlug}/events/`; otherwise it validates `/organizations/{organizationSlug}/projects/`.",
      "Leave `credentials.apiBaseUrl` empty for Sentry Cloud. Set it only for self-hosted Sentry, using the canonical API root such as `https://sentry.example.com/api/0`.",
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
  {
    provider: "github",
    summary:
      "Connect GitHub with a fine-grained personal access token and optional repository or installation scoping.",
    steps: [
      "Open `https://github.com/settings/personal-access-tokens/new` and create a fine-grained personal access token.",
      "Choose the correct resource owner, set `Repository access` to `Only select repositories`, and select the repositories OneQuery should query.",
      "Under repository permissions, set `Contents`, `Issues`, and `Pull requests` to `Read-only`. GitHub also requires `Metadata: Read-only`.",
      "Copy the token immediately and use it as `credentials.accessToken`. If the token belongs to a GitHub App installation, also include `installationId`; optionally restrict the OneQuery connection further with `repositories`.",
    ],
    exampleInput: {
      sourceKey: "github_main",
      credentials: {
        accessToken: "github_pat_or_installation_token",
        repositories: ["octocat/Hello-World"],
      },
    },
  },
  {
    provider: "linear",
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
  {
    provider: "cloudflare_workers_observability",
    summary:
      "Connect Cloudflare Workers Observability with an account-scoped API token and account ID.",
    steps: [
      "Enable Workers Logs in the target Worker's Wrangler configuration and redeploy so Cloudflare stores telemetry for the account.",
      "Create a Cloudflare API token with the Workers Observability permission required by the telemetry API.",
      "Copy the Cloudflare Account ID from the dashboard and pass it as `credentials.accountId`.",
      "Optionally include `scriptName` to document the default Worker service this source usually queries. OneQuery still allows account-level telemetry queries.",
      "Leave `apiBaseUrl` unset unless you are testing against a non-default Cloudflare API host.",
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
];

function sourceConnectProviderGuide(provider: ProviderType) {
  const guide = SOURCE_CONNECT_PROVIDERS.find(
    (entry) => entry.provider === provider
  );
  if (!guide) {
    throw new Error(`unsupported source connect provider: ${provider}`);
  }
  return guide;
}

export function buildCliSourceConnectGuide(provider: ProviderType) {
  const guide = sourceConnectProviderGuide(provider);

  return {
    command: buildCliSourceConnectCommand(provider),
    content: buildSourceConnectContent(guide),
    description: `Follow these steps to gather credentials and create one ${provider} org-scoped OneQuery source.`,
    format: "markdown" as const,
    title: "OneQuery Source Connect Guide",
  };
}

export function buildCliSourceConnectResult(source: CliSourceRecord) {
  return {
    nextCommand: buildCliSourceShowCommand(source.sourceKey),
    source,
  };
}

function buildSourceConnectContent(
  provider: SourceConnectProviderGuide
): string {
  const lines = [
    "# OneQuery Source Connect Guide",
    "",
    `Provider: \`${provider.provider}\``,
    "",
    "Agent workflow:",
    "1. If this provider requires a browser or dashboard setup flow, do not just ask the user to hand over the final token or secret. Work through the setup with the user step by step.",
    "2. First check whether you already have browser capability in the current environment.",
    "3. If browser capability is missing, install `agent-browser` with `npx skills add https://github.com/vercel-labs/agent-browser --skill agent-browser`, then follow that skill to open a browser and continue the setup with the user.",
    "4. Only use the final credential value when you are ready to build the JSON input and run the connect command.",
    "",
    "Use a CLI-safe `sourceKey` such as `warehouse` or `github_main`.",
    `Run: \`${buildCliSourceConnectCommand(provider.provider)}\``,
    "Verify: `onequery source show <source_key>`",
    "Do not include `organizationId` or `organizationSlug`; the CLI injects org context automatically.",
    'The JSON input shape is always `{ "sourceKey": string, "credentials": { ...provider-specific fields... } }`.',
    "",
    provider.summary,
    "",
    "Steps:",
  ];

  for (const [index, step] of provider.steps.entries()) {
    lines.push(`${index + 1}. ${step}`);
  }
  lines.push("");
  lines.push("Example input:");
  lines.push("```json");
  lines.push(JSON.stringify(provider.exampleInput, null, 2));
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}
