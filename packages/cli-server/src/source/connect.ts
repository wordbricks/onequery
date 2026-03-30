import type { ProviderType } from "@onequery/db/server";

import {
  CLI_DEFAULT_RELAY_TIMEOUT_MS,
  buildCliSourceConnectCommand,
  buildCliSourceShowCommand,
} from "../cli-defaults";
import type { CliSourceRecord } from "../domain/workflows";
import { createCliProblem } from "../error";
import { CLI_SAFE_PATH_SEGMENT_PATTERN } from "../identifiers";
import { buildCliSourceSummary } from "./model";

type SourceConnectProviderGuide = {
  provider: ProviderType;
  summary: string;
  requiredCredentialFields: string[];
  optionalCredentialFields: string[];
  steps: string[];
  credentialTemplate: Record<string, unknown>;
  exampleInput: Record<string, unknown>;
};
const SOURCE_CONNECT_PROVIDERS: SourceConnectProviderGuide[] = [
  {
    provider: "postgres",
    summary:
      "Connect a Postgres database with a direct host, database, and login.",
    requiredCredentialFields: [
      "type",
      "host",
      "database",
      "username",
      "password",
    ],
    optionalCredentialFields: ["port", "sslMode"],
    steps: [
      "Retrieve the Postgres host, database name, username, and password from the database deployment or secret manager.",
      "Confirm the correct port and SSL mode for this environment before sending the payload.",
    ],
    credentialTemplate: {
      type: "postgres",
      host: "db.example.com",
      port: 5432,
      database: "app",
      username: "onequery",
      password: "secret",
      sslMode: "prefer",
    },
    exampleInput: {
      name: "warehouse",
      credentials: {
        type: "postgres",
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
      "Connect Supabase with the project database host, database, and login credentials over the Postgres wire protocol.",
    requiredCredentialFields: [
      "type",
      "host",
      "database",
      "username",
      "password",
    ],
    optionalCredentialFields: ["port", "sslMode"],
    steps: [
      "Open the Supabase project settings and retrieve the direct Postgres connection host, database name, username, and password.",
      "Set `credentials.type` to `postgres`. The CLI keeps the source provider as `supabase`, but the persisted credential shape still uses the Postgres transport fields.",
      "Keep SSL enabled for the project database connection and confirm the correct port before building the payload.",
    ],
    credentialTemplate: {
      type: "postgres",
      host: "db.project-ref.supabase.co",
      port: 5432,
      database: "postgres",
      username: "postgres.project-ref",
      password: "supabase-db-password",
      sslMode: "require",
    },
    exampleInput: {
      name: "supabase_prod",
      credentials: {
        type: "postgres",
        host: "db.project-ref.supabase.co",
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
    requiredCredentialFields: [
      "type",
      "host",
      "database",
      "username",
      "password",
    ],
    optionalCredentialFields: ["port", "sslMode"],
    steps: [
      "Retrieve the MySQL host, database name, username, and password from the deployment or secret manager.",
      "Confirm the port and SSL requirement before building the payload.",
    ],
    credentialTemplate: {
      type: "mysql",
      host: "mysql.example.com",
      port: 3306,
      database: "app",
      username: "onequery",
      password: "secret",
      sslMode: "prefer",
    },
    exampleInput: {
      name: "mysql_prod",
      credentials: {
        type: "mysql",
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
    requiredCredentialFields: ["type", "connectionString"],
    optionalCredentialFields: ["database", "databases"],
    steps: [
      "Retrieve a MongoDB connection string with the required read access.",
      "If the deployment spans multiple databases, include `databases`; otherwise provide one `database`.",
    ],
    credentialTemplate: {
      type: "mongodb",
      connectionString: "mongodb+srv://user:password@cluster.example.com",
      database: "analytics",
      databases: ["analytics"],
    },
    exampleInput: {
      name: "mongo_analytics",
      credentials: {
        type: "mongodb",
        connectionString: "mongodb+srv://user:password@cluster.example.com",
        database: "analytics",
      },
    },
  },
  {
    provider: "bigquery",
    summary:
      "Connect BigQuery with either Google OAuth tokens or a Google Cloud service account JSON key.",
    requiredCredentialFields: ["type", "projectId"],
    optionalCredentialFields: [
      "authType",
      "accessToken",
      "refreshToken",
      "expiresAt",
      "serviceAccount",
    ],
    steps: [
      "Retrieve the Google Cloud `projectId` that owns the datasets OneQuery should query.",
      "For the live service-account flow, create a Google Cloud service account in that project, grant `BigQuery Data Viewer` and `BigQuery Job User`, then create a JSON key from `Keys > Add key > Create new key > JSON`.",
      'The CLI does not normalize raw Google service-account JSON. Convert the downloaded file into `authType: "service_account"` plus `serviceAccount.projectId`, `clientEmail`, `privateKey`, and optional `privateKeyId`.',
      "OneQuery tests BigQuery by running `SELECT 1 AS onequery_connection_test`, so the credential must be able to start jobs and read datasets in the target project.",
      "If you use OAuth instead, provide `accessToken`, `refreshToken`, and `expiresAt` with the `https://www.googleapis.com/auth/bigquery.readonly` scope.",
    ],
    credentialTemplate: {
      type: "bigquery",
      authType: "service_account",
      projectId: "analytics-project",
      serviceAccount: {
        projectId: "analytics-project",
        clientEmail: "onequery@analytics-project.iam.gserviceaccount.com",
        privateKey:
          "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
        privateKeyId: "key-id",
      },
    },
    exampleInput: {
      name: "bigquery_prod",
      credentials: {
        type: "bigquery",
        authType: "service_account",
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
    requiredCredentialFields: ["type", "apiKey"],
    optionalCredentialFields: ["apiBaseUrl"],
    steps: [
      "Retrieve a Laminar API key with access to the target workspace.",
      "Only include `apiBaseUrl` when the account uses a non-default Laminar API host.",
    ],
    credentialTemplate: {
      type: "laminar",
      apiKey: "laminar_api_key",
      apiBaseUrl: "https://api.laminar.ai",
    },
    exampleInput: {
      name: "laminar_main",
      credentials: {
        type: "laminar",
        apiKey: "laminar_api_key",
      },
    },
  },
  {
    provider: "aws_athena_connector",
    summary:
      "Connect an Athena connector already registered with this org in OneQuery.",
    requiredCredentialFields: ["type", "connectorId", "database"],
    optionalCredentialFields: ["workgroup", "maxRows", "timeoutMs"],
    steps: [
      "Retrieve the OneQuery connector ID for the Athena connector already linked to this org.",
      "Retrieve the Athena database name and optional workgroup override for the queries you want to run.",
    ],
    credentialTemplate: {
      type: "aws_athena_connector",
      connectorId: "connector_01HXYZ",
      database: "analytics",
      workgroup: "primary",
      maxRows: 1000,
      timeoutMs: CLI_DEFAULT_RELAY_TIMEOUT_MS,
    },
    exampleInput: {
      name: "athena_main",
      credentials: {
        type: "aws_athena_connector",
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
    requiredCredentialFields: ["type", "propertyId"],
    optionalCredentialFields: [
      "authType",
      "accessToken",
      "refreshToken",
      "expiresAt",
      "serviceAccount",
    ],
    steps: [
      "Retrieve the GA4 `propertyId` from `Admin > Property details`. OneQuery accepts either plain digits such as `123456789` or the prefixed form `properties/123456789`.",
      "For the live service-account flow, create a Google Cloud service account, create a JSON key, then in GA4 `Admin > Property access management` add that service-account email as a `Viewer` with no extra data restrictions checked.",
      'The CLI does not normalize raw Google service-account JSON. Convert the downloaded file into `authType: "service_account"` plus `serviceAccount.projectId`, `clientEmail`, `privateKey`, and optional `privateKeyId`.',
      "OneQuery tests GA by calling `runReport` for the `activeUsers` metric, so the service account only needs read access to the target property.",
      "If you use OAuth instead, provide `accessToken`, `refreshToken`, and `expiresAt` with the `https://www.googleapis.com/auth/analytics.readonly` scope.",
    ],
    credentialTemplate: {
      type: "ga",
      authType: "service_account",
      propertyId: "123456789",
      serviceAccount: {
        projectId: "analytics-project",
        clientEmail: "onequery@analytics-project.iam.gserviceaccount.com",
        privateKey:
          "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
      },
    },
    exampleInput: {
      name: "ga_marketing",
      credentials: {
        type: "ga",
        authType: "service_account",
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
    requiredCredentialFields: ["type", "apiKey", "secretKey"],
    optionalCredentialFields: ["region"],
    steps: [
      "In Amplitude Settings, open `Projects`, choose the target project, and go to its `General` page.",
      "In the `Project Details` card, click `Show` next to `Secret Key` and copy that value into `credentials.secretKey`.",
      "Click `Manage` next to `API Key`, then on `API and Secret Keys` copy an active API key for that project or click `Generate API Key` if you need a new one. Use that value as `credentials.apiKey`.",
      "Set `region` to `eu` only for Amplitude EU projects; otherwise use `us`.",
    ],
    credentialTemplate: {
      type: "amplitude",
      apiKey: "amplitude_api_key",
      secretKey: "amplitude_secret",
      region: "us",
    },
    exampleInput: {
      name: "amplitude_product",
      credentials: {
        type: "amplitude",
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
    requiredCredentialFields: ["type", "projectId", "username", "secret"],
    optionalCredentialFields: ["region", "workspaceId"],
    steps: [
      "In Mixpanel Settings, open `Org` -> `Service Accounts`, click `Add Service Account`, keep `Organization Role` set to `Member`, select the target project, and keep `Project Role` set to `Consumer`.",
      "Copy the one-time `Username` and `Secret` into `credentials.username` and `credentials.secret`. If the secret is exposed, delete the service account or rotate it before using it again.",
      "Open Settings -> `Project` -> `Overview`, copy `Project ID`, and map `Data Residency` to `region`: `US` -> `us`, `EU` -> `eu`, `India` -> `in`.",
      "Leave `workspaceId` unset unless you already know your Mixpanel setup requires a specific workspace or data view override.",
    ],
    credentialTemplate: {
      type: "mixpanel",
      projectId: "12345",
      username: "service-account",
      secret: "service-account-secret",
      region: "us",
      workspaceId: "workspace_01",
    },
    exampleInput: {
      name: "mixpanel_growth",
      credentials: {
        type: "mixpanel",
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
      "Connect PostHog with a host URL, personal API key, and project ID.",
    requiredCredentialFields: [
      "type",
      "hostUrl",
      "personalApiKey",
      "projectId",
    ],
    optionalCredentialFields: [],
    steps: [
      "Retrieve the PostHog instance URL, the target project ID, and a personal API key with read access.",
      "Use the canonical host URL without a trailing slash; the server normalizes extra trailing slashes.",
    ],
    credentialTemplate: {
      type: "posthog",
      hostUrl: "https://us.i.posthog.com",
      personalApiKey: "phx_personal_key",
      projectId: "12345",
    },
    exampleInput: {
      name: "posthog_main",
      credentials: {
        type: "posthog",
        hostUrl: "https://us.i.posthog.com",
        personalApiKey: "phx_personal_key",
        projectId: "12345",
      },
    },
  },
  {
    provider: "sentry",
    summary:
      "Connect Sentry with a Personal Token, organization slug, optional project slug, and optional self-hosted API base URL.",
    requiredCredentialFields: ["type", "authToken", "organizationSlug"],
    optionalCredentialFields: ["apiBaseUrl", "projectSlug"],
    steps: [
      "Open `https://sentry.io/settings/account/api/auth-tokens/`, click `Create New Token`, and use the live Sentry Personal Token flow.",
      "Set `Project = Read` and `Organization = Read`. If you will set `projectSlug` or want project event access, also set `Issue & Event = Read`. Sentry previews these as `project:read`, `organization:read`, and `event:read`.",
      "Copy the token immediately after creation and pass it as `credentials.authToken`. Sentry shows the token value only once.",
      "Read `Organization Slug` from Settings > Organization > General and pass it as `credentials.organizationSlug`.",
      "Optional: read `Slug` from Settings > Projects > <project> > General and pass it as `credentials.projectSlug`. When `projectSlug` is present, OneQuery validates `/projects/{organizationSlug}/{projectSlug}/events/`; otherwise it validates `/organizations/{organizationSlug}/projects/`.",
      "Leave `credentials.apiBaseUrl` empty for Sentry Cloud. Set it only for self-hosted Sentry, using the canonical API root such as `https://sentry.example.com/api/0`.",
    ],
    credentialTemplate: {
      type: "sentry",
      authToken: "sntrys_...",
      organizationSlug: "your-org-slug",
      projectSlug: "your-project-slug",
      apiBaseUrl: "https://sentry.io/api/0",
    },
    exampleInput: {
      name: "sentry_main",
      credentials: {
        type: "sentry",
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
    requiredCredentialFields: ["type", "accessToken"],
    optionalCredentialFields: ["installationId", "repositories"],
    steps: [
      "Open `https://github.com/settings/personal-access-tokens/new` and create a fine-grained personal access token.",
      "Choose the correct resource owner, set `Repository access` to `Only select repositories`, and select the repositories OneQuery should query.",
      "Under repository permissions, set `Contents`, `Issues`, and `Pull requests` to `Read-only`. GitHub also requires `Metadata: Read-only`.",
      "Copy the token immediately and use it as `credentials.accessToken`. If the token belongs to a GitHub App installation, also include `installationId`; optionally restrict the OneQuery connection further with `repositories`.",
    ],
    credentialTemplate: {
      type: "github",
      accessToken: "github_pat_or_installation_token",
      installationId: "123456",
      repositories: ["octocat/Hello-World"],
    },
    exampleInput: {
      name: "github_main",
      credentials: {
        type: "github",
        accessToken: "github_pat_or_installation_token",
        repositories: ["octocat/Hello-World"],
      },
    },
  },
  {
    provider: "linear",
    summary:
      "Connect Linear with either an API key or a full OAuth token bundle.",
    requiredCredentialFields: ["type"],
    optionalCredentialFields: [
      "apiKey",
      "accessToken",
      "linearOrganizationId",
      "linearOrganizationName",
      "refreshToken",
      "expiresAt",
      "scope",
      "tokenType",
      "appUserId",
    ],
    steps: [
      "Choose either the API key shape (`apiKey`) or the OAuth shape (`accessToken` plus `linearOrganizationId`).",
      "If you use OAuth, keep the refresh metadata so the server can keep the connection valid over time.",
    ],
    credentialTemplate: {
      type: "linear",
      accessToken: "linear_access_token",
      linearOrganizationId: "org_123",
      linearOrganizationName: "Acme",
      refreshToken: "linear_refresh_token",
      expiresAt: "2026-04-01T00:00:00.000Z",
      tokenType: "Bearer",
      scope: "read",
      appUserId: "user_123",
    },
    exampleInput: {
      name: "linear_main",
      credentials: {
        type: "linear",
        apiKey: "lin_api_key",
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
    inputSchema: {
      properties: {
        credentials: {
          description:
            "Provider-specific credential object. `credentials.type` must exactly match the selected `--source`.",
          type: "object",
        },
        name: {
          description:
            "CLI-safe org-unique source key. Use only letters, numbers, dots, underscores, and hyphens.",
          pattern: CLI_SAFE_PATH_SEGMENT_PATTERN.source,
          type: "string",
        },
      },
      required: ["name", "credentials"],
      type: "object",
    },
    providers: [guide],
    title: "OneQuery Source Connect Guide",
  };
}

export function buildCliSourceConnectResult(source: CliSourceRecord) {
  return {
    nextCommand: buildCliSourceShowCommand(source.sourceKey),
    source: buildCliSourceSummary(source),
  };
}

export function sourceNameConflictProblem(orgSlug: string, sourceName: string) {
  return createCliProblem({
    detail: `source "${sourceName}" already exists in org "${orgSlug}"`,
    key: "SOURCE_NAME_CONFLICT",
  });
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
    "Use a CLI-safe `name` such as `warehouse` or `github_main`.",
    `Run: \`${buildCliSourceConnectCommand(provider.provider)}\``,
    "Verify: `oneq source show <name>`",
    "Do not include `organizationId` or `organizationSlug`; the CLI injects org context automatically.",
    "",
    provider.summary,
    "",
    `Required credential fields: ${provider.requiredCredentialFields.join(", ")}`,
    `Optional credential fields: ${
      provider.optionalCredentialFields.length > 0
        ? provider.optionalCredentialFields.join(", ")
        : "(none)"
    }`,
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
