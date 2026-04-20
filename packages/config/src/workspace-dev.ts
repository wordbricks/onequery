import { z } from "zod";

import { sharedSecretSectionsSchema } from "./shared-secrets";

const WORKSPACE_DEV_DATABASE_HOST = "localhost";
const nonEmptyStringSchema = z.string().trim().min(1);
const portSchema = z.number().int().min(1).max(65535);
const strictObject = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object(shape).strict();

const workspaceDevBaseShape = {
  api: strictObject({
    host: nonEmptyStringSchema,
    port: portSchema,
  }),
  browser: strictObject({
    host: nonEmptyStringSchema,
    port: portSchema,
  }),
  flags: strictObject({
    disable_rate_limit: z.boolean(),
  }),
  postgres: strictObject({
    container_port: portSchema,
    database: nonEmptyStringSchema,
    host_port: portSchema,
    password: nonEmptyStringSchema,
    user: nonEmptyStringSchema,
  }),
} satisfies z.ZodRawShape;

function validateUniqueHostPorts(
  value: {
    readonly api: { readonly port: number };
    readonly browser: { readonly port: number };
    readonly postgres: { readonly host_port: number };
  },
  context: z.RefinementCtx
): void {
  const seen = new Map<number, string>();
  const hostPorts: Array<{
    readonly label: string;
    readonly path: string[];
    readonly port: number;
  }> = [
    {
      label: "browser.port",
      path: ["browser", "port"],
      port: value.browser.port,
    },
    {
      label: "api.port",
      path: ["api", "port"],
      port: value.api.port,
    },
    {
      label: "postgres.host_port",
      path: ["postgres", "host_port"],
      port: value.postgres.host_port,
    },
  ];

  for (const entry of hostPorts) {
    const existing = seen.get(entry.port);
    if (existing) {
      context.addIssue({
        code: "custom",
        message: `Workspace-dev host ports must be unique. "${entry.label}" conflicts with "${existing}" on ${entry.port}.`,
        path: entry.path,
      });
      continue;
    }

    seen.set(entry.port, entry.label);
  }
}

export const workspaceDevConfigSchema = z
  .object(workspaceDevBaseShape)
  .strict()
  .superRefine(validateUniqueHostPorts);

export const workspaceDevSecretsSchema = sharedSecretSectionsSchema;

export type WorkspaceDevConfigFile = z.output<typeof workspaceDevConfigSchema>;
export type WorkspaceDevSecretsFile = z.output<
  typeof workspaceDevSecretsSchema
>;

export const WORKSPACE_DEV_CONFIG_FILENAME = "onequery.dev.toml";
export const WORKSPACE_DEV_SECRETS_FILENAME = "onequery.dev.secrets.toml";

export interface WorkspaceDevBrowserConfig {
  readonly host: string;
  readonly origin: string;
  readonly port: number;
}

export interface WorkspaceDevApiConfig {
  readonly host: string;
  readonly listen: {
    readonly host: string;
    readonly port: number;
  };
  readonly origin: string;
  readonly port: number;
}

export interface WorkspaceDevPostgresConfig {
  readonly containerPort: number;
  readonly database: string;
  readonly host: string;
  readonly hostPort: number;
  readonly password: string;
  readonly portBinding: string;
  readonly url: string;
  readonly user: string;
}

export interface ResolvedWorkspaceDevConfig {
  readonly api: WorkspaceDevApiConfig;
  readonly auth: {
    readonly secret: string;
  };
  readonly browser: WorkspaceDevBrowserConfig;
  readonly connectors: {
    readonly enrollmentToken: string;
  };
  readonly crypto: {
    readonly masterEncryptionKey: string;
  };
  readonly flags: {
    readonly disableRateLimit: boolean;
  };
  readonly postgres: WorkspaceDevPostgresConfig;
  readonly profile: "workspace-dev";
  readonly publicOrigin: string;
}

export type WorkspaceDevParseSource = "config" | "secrets";

export interface WorkspaceDevParseIssue {
  readonly message: string;
  readonly path: readonly PropertyKey[];
  readonly source: WorkspaceDevParseSource;
}

export interface WorkspaceDevParseError {
  readonly issues: readonly WorkspaceDevParseIssue[];
}

export type ParseWorkspaceDevResult =
  | {
      readonly ok: true;
      readonly value: ResolvedWorkspaceDevConfig;
    }
  | {
      readonly error: WorkspaceDevParseError;
      readonly ok: false;
    };

function createHttpOrigin(host: string, port: number): string {
  return `http://${host}:${port}`;
}

function createPostgresUrl(input: {
  readonly database: string;
  readonly host: string;
  readonly password: string;
  readonly port: number;
  readonly user: string;
}): string {
  return `postgres://${input.user}:${input.password}@${input.host}:${input.port}/${input.database}`;
}

export function formatWorkspaceDevIssuePath(
  path: readonly PropertyKey[]
): string {
  return path.length === 0
    ? "(root)"
    : path.map((entry) => String(entry)).join(".");
}

function buildResolvedWorkspaceDevConfig(input: {
  readonly config: WorkspaceDevConfigFile;
  readonly secrets: WorkspaceDevSecretsFile;
}): ResolvedWorkspaceDevConfig {
  const browser = {
    host: input.config.browser.host,
    origin: createHttpOrigin(
      input.config.browser.host,
      input.config.browser.port
    ),
    port: input.config.browser.port,
  };
  const api = {
    host: input.config.api.host,
    listen: {
      host: input.config.api.host,
      port: input.config.api.port,
    },
    origin: createHttpOrigin(input.config.api.host, input.config.api.port),
    port: input.config.api.port,
  };
  const postgres = {
    containerPort: input.config.postgres.container_port,
    database: input.config.postgres.database,
    host: WORKSPACE_DEV_DATABASE_HOST,
    hostPort: input.config.postgres.host_port,
    password: input.config.postgres.password,
    portBinding: `${input.config.postgres.host_port}:${input.config.postgres.container_port}`,
    url: createPostgresUrl({
      database: input.config.postgres.database,
      host: WORKSPACE_DEV_DATABASE_HOST,
      password: input.config.postgres.password,
      port: input.config.postgres.host_port,
      user: input.config.postgres.user,
    }),
    user: input.config.postgres.user,
  };

  return {
    api,
    auth: {
      secret: input.secrets.auth.secret,
    },
    browser,
    connectors: {
      enrollmentToken: input.secrets.connectors.enrollment_token,
    },
    crypto: {
      masterEncryptionKey: input.secrets.crypto.master_encryption_key,
    },
    flags: {
      disableRateLimit: input.config.flags.disable_rate_limit,
    },
    postgres,
    profile: "workspace-dev",
    publicOrigin: browser.origin,
  };
}

function toWorkspaceDevParseIssues(
  source: WorkspaceDevParseSource,
  error: z.ZodError
): WorkspaceDevParseIssue[] {
  return error.issues.map((issue) => ({
    message: issue.message,
    path: issue.path,
    source,
  }));
}

export function parseWorkspaceDev(input: {
  readonly config: unknown;
  readonly secrets: unknown;
}): ParseWorkspaceDevResult {
  const parsedConfig = workspaceDevConfigSchema.safeParse(input.config);
  const parsedSecrets = workspaceDevSecretsSchema.safeParse(input.secrets);
  if (!parsedConfig.success || !parsedSecrets.success) {
    const issues: WorkspaceDevParseIssue[] = [];

    if (!parsedConfig.success) {
      issues.push(...toWorkspaceDevParseIssues("config", parsedConfig.error));
    }

    if (!parsedSecrets.success) {
      issues.push(...toWorkspaceDevParseIssues("secrets", parsedSecrets.error));
    }

    return {
      error: {
        issues,
      },
      ok: false,
    };
  }

  return {
    ok: true,
    value: buildResolvedWorkspaceDevConfig({
      config: parsedConfig.data,
      secrets: parsedSecrets.data,
    }),
  };
}
