import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readTomlFileSync, type TomlFileData } from "@onequery/config-loader";
import { z } from "zod";

const defaultRootDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

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

export const workspaceDevSecretsSchema = strictObject({
  auth: strictObject({
    secret: nonEmptyStringSchema,
  }),
  connectors: strictObject({
    enrollment_token: nonEmptyStringSchema,
  }),
  crypto: strictObject({
    master_encryption_key: nonEmptyStringSchema,
  }),
});

export const WORKSPACE_DEV_CONFIG_FILENAME = "onequery.dev.toml";
export const WORKSPACE_DEV_SECRETS_FILENAME = "onequery.dev.secrets.toml";

export interface WorkspaceDevPaths {
  readonly configPath: string;
  readonly rootDir: string;
  readonly secretsPath: string;
}

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
  readonly paths: WorkspaceDevPaths;
  readonly postgres: WorkspaceDevPostgresConfig;
  readonly profile: "workspace-dev";
  readonly publicOrigin: string;
}

export interface ResolveWorkspaceDevOptions {
  readonly rootDir?: string;
}

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

function readOptionalTomlFile(path: string): TomlFileData {
  return existsSync(path) ? readTomlFileSync(path) : {};
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "(root)" : path.map((entry) => String(entry)).join(".");
}

function buildWorkspaceDevError(
  error: z.ZodError,
  input: {
    readonly paths: WorkspaceDevPaths;
    readonly sourceLabel: "Config" | "Secrets";
    readonly sourcePath: string;
  }
): Error {
  const issues = error.issues.map(
    (issue) => `- ${formatIssuePath(issue.path)}: ${issue.message}`
  );

  return new Error(
    [
      "Invalid workspace-dev config.",
      `Config: ${input.paths.configPath}`,
      `Secrets: ${input.paths.secretsPath}`,
      `${input.sourceLabel}: ${input.sourcePath}`,
      ...issues,
    ].join("\n")
  );
}

export function resolveWorkspaceDevPaths(rootDir: string = defaultRootDir): WorkspaceDevPaths {
  return {
    configPath: resolve(rootDir, WORKSPACE_DEV_CONFIG_FILENAME),
    rootDir,
    secretsPath: resolve(rootDir, WORKSPACE_DEV_SECRETS_FILENAME),
  };
}

export function resolveWorkspaceDev(
  input: ResolveWorkspaceDevOptions = {}
): ResolvedWorkspaceDevConfig {
  const paths = resolveWorkspaceDevPaths(input.rootDir);
  const parsedConfig = workspaceDevConfigSchema.safeParse(
    readOptionalTomlFile(paths.configPath)
  );

  if (!parsedConfig.success) {
    throw buildWorkspaceDevError(parsedConfig.error, {
      paths,
      sourceLabel: "Config",
      sourcePath: paths.configPath,
    });
  }

  const parsedSecrets = workspaceDevSecretsSchema.safeParse(
    readOptionalTomlFile(paths.secretsPath)
  );

  if (!parsedSecrets.success) {
    throw buildWorkspaceDevError(parsedSecrets.error, {
      paths,
      sourceLabel: "Secrets",
      sourcePath: paths.secretsPath,
    });
  }

  const parsed = {
    ...parsedConfig.data,
    ...parsedSecrets.data,
  };

  const browser = {
    host: parsed.browser.host,
    origin: createHttpOrigin(parsed.browser.host, parsed.browser.port),
    port: parsed.browser.port,
  };
  const api = {
    host: parsed.api.host,
    listen: {
      host: parsed.api.host,
      port: parsed.api.port,
    },
    origin: createHttpOrigin(parsed.api.host, parsed.api.port),
    port: parsed.api.port,
  };
  const postgres = {
    containerPort: parsed.postgres.container_port,
    database: parsed.postgres.database,
    host: WORKSPACE_DEV_DATABASE_HOST,
    hostPort: parsed.postgres.host_port,
    password: parsed.postgres.password,
    portBinding: `${parsed.postgres.host_port}:${parsed.postgres.container_port}`,
    url: createPostgresUrl({
      database: parsed.postgres.database,
      host: WORKSPACE_DEV_DATABASE_HOST,
      password: parsed.postgres.password,
      port: parsed.postgres.host_port,
      user: parsed.postgres.user,
    }),
    user: parsed.postgres.user,
  };

  return {
    api,
    auth: {
      secret: parsed.auth.secret,
    },
    browser,
    connectors: {
      enrollmentToken: parsed.connectors.enrollment_token,
    },
    crypto: {
      masterEncryptionKey: parsed.crypto.master_encryption_key,
    },
    flags: {
      disableRateLimit: parsed.flags.disable_rate_limit,
    },
    paths,
    postgres,
    profile: "workspace-dev",
    publicOrigin: browser.origin,
  };
}
