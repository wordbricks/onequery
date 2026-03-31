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

const workspaceDevBaseShape = {
  api: z.object({
    host: nonEmptyStringSchema,
    port: portSchema,
  }),
  browser: z.object({
    host: nonEmptyStringSchema,
    port: portSchema,
  }),
  flags: z.object({
    disable_rate_limit: z.boolean(),
  }),
  postgres: z.object({
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
  .superRefine(validateUniqueHostPorts);

export const workspaceDevSecretsSchema = z.object({
  auth: z.object({
    secret: nonEmptyStringSchema,
  }),
  connectors: z.object({
    enrollment_token: nonEmptyStringSchema,
  }),
  crypto: z.object({
    master_encryption_key: nonEmptyStringSchema,
  }),
});

const workspaceDevSourceSchema = z
  .object({
    ...workspaceDevBaseShape,
    auth: workspaceDevSecretsSchema.shape.auth,
    connectors: workspaceDevSecretsSchema.shape.connectors,
    crypto: workspaceDevSecretsSchema.shape.crypto,
  })
  .superRefine(validateUniqueHostPorts);

const workspaceDevDefaults = {
  api: {
    host: "127.0.0.1",
    port: 4555,
  },
  browser: {
    host: "localhost",
    port: 4545,
  },
  flags: {
    disable_rate_limit: true,
  },
  postgres: {
    container_port: 5432,
    database: "onequery",
    host_port: 5454,
    password: "onequery",
    user: "onequery",
  },
} satisfies z.output<typeof workspaceDevConfigSchema>;

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeTomlRecords(
  base: Readonly<Record<string, unknown>>,
  overlay: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...base,
  };

  for (const [key, value] of Object.entries(overlay)) {
    const currentValue = merged[key];

    merged[key] =
      isPlainObject(currentValue) && isPlainObject(value)
        ? mergeTomlRecords(currentValue, value)
        : value;
  }

  return merged;
}

function readOptionalTomlFile(path: string): TomlFileData {
  return existsSync(path) ? readTomlFileSync(path) : {};
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "(root)" : path.map((entry) => String(entry)).join(".");
}

function buildWorkspaceDevError(
  error: z.ZodError,
  paths: WorkspaceDevPaths
): Error {
  const issues = error.issues.map(
    (issue) => `- ${formatIssuePath(issue.path)}: ${issue.message}`
  );

  return new Error(
    [
      "Invalid workspace-dev config.",
      `Config: ${paths.configPath}`,
      `Secrets: ${paths.secretsPath}`,
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
  const mergedSource = mergeTomlRecords(
    mergeTomlRecords(workspaceDevDefaults, readOptionalTomlFile(paths.configPath)),
    readOptionalTomlFile(paths.secretsPath)
  );
  const parsed = workspaceDevSourceSchema.safeParse(mergedSource);

  if (!parsed.success) {
    throw buildWorkspaceDevError(parsed.error, paths);
  }

  const browser = {
    host: parsed.data.browser.host,
    origin: createHttpOrigin(parsed.data.browser.host, parsed.data.browser.port),
    port: parsed.data.browser.port,
  };
  const api = {
    host: parsed.data.api.host,
    listen: {
      host: parsed.data.api.host,
      port: parsed.data.api.port,
    },
    origin: createHttpOrigin(parsed.data.api.host, parsed.data.api.port),
    port: parsed.data.api.port,
  };
  const postgres = {
    containerPort: parsed.data.postgres.container_port,
    database: parsed.data.postgres.database,
    host: WORKSPACE_DEV_DATABASE_HOST,
    hostPort: parsed.data.postgres.host_port,
    password: parsed.data.postgres.password,
    portBinding: `${parsed.data.postgres.host_port}:${parsed.data.postgres.container_port}`,
    url: createPostgresUrl({
      database: parsed.data.postgres.database,
      host: WORKSPACE_DEV_DATABASE_HOST,
      password: parsed.data.postgres.password,
      port: parsed.data.postgres.host_port,
      user: parsed.data.postgres.user,
    }),
    user: parsed.data.postgres.user,
  };

  return {
    api,
    auth: {
      secret: parsed.data.auth.secret,
    },
    browser,
    connectors: {
      enrollmentToken: parsed.data.connectors.enrollment_token,
    },
    crypto: {
      masterEncryptionKey: parsed.data.crypto.master_encryption_key,
    },
    flags: {
      disableRateLimit: parsed.data.flags.disable_rate_limit,
    },
    paths,
    postgres,
    profile: "workspace-dev",
    publicOrigin: browser.origin,
  };
}
