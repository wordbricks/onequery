import { z } from "zod";

import { sharedSecretSectionsSchema } from "./shared-secrets";

export const workspaceDevSecretsSchema = sharedSecretSectionsSchema;

export type WorkspaceDevSecretsFile = z.output<
  typeof workspaceDevSecretsSchema
>;

export const WORKSPACE_DEV_HOME_DIRNAME = ".onequery";
export const WORKSPACE_DEV_PROFILE_DIRNAME = "dev";
export const WORKSPACE_DEV_SECRETS_FILENAME = "secrets.toml";
export const WORKSPACE_DEV_BROWSER_HOST = "localhost";
export const WORKSPACE_DEV_BROWSER_PORT = 4545;
export const WORKSPACE_DEV_API_HOST = "127.0.0.1";
export const WORKSPACE_DEV_API_PORT = 4555;

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
  readonly profile: "workspace-dev";
  readonly publicOrigin: string;
}

export interface WorkspaceDevParseIssue {
  readonly message: string;
  readonly path: readonly PropertyKey[];
  readonly source: "secrets";
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

export function formatWorkspaceDevIssuePath(
  path: readonly PropertyKey[]
): string {
  return path.length === 0
    ? "(root)"
    : path.map((entry) => String(entry)).join(".");
}

export function createDefaultWorkspaceDevConfig(input: {
  readonly secrets: WorkspaceDevSecretsFile;
}): ResolvedWorkspaceDevConfig {
  const browser = {
    host: WORKSPACE_DEV_BROWSER_HOST,
    origin: createHttpOrigin(
      WORKSPACE_DEV_BROWSER_HOST,
      WORKSPACE_DEV_BROWSER_PORT
    ),
    port: WORKSPACE_DEV_BROWSER_PORT,
  };
  const api = {
    host: WORKSPACE_DEV_API_HOST,
    listen: {
      host: WORKSPACE_DEV_API_HOST,
      port: WORKSPACE_DEV_API_PORT,
    },
    origin: createHttpOrigin(WORKSPACE_DEV_API_HOST, WORKSPACE_DEV_API_PORT),
    port: WORKSPACE_DEV_API_PORT,
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
      disableRateLimit: true,
    },
    profile: "workspace-dev",
    publicOrigin: browser.origin,
  };
}

export function parseWorkspaceDev(input: {
  readonly secrets: unknown;
}): ParseWorkspaceDevResult {
  const parsedSecrets = workspaceDevSecretsSchema.safeParse(input.secrets);
  if (!parsedSecrets.success) {
    return {
      error: {
        issues: parsedSecrets.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path,
          source: "secrets",
        })),
      },
      ok: false,
    };
  }

  return {
    ok: true,
    value: createDefaultWorkspaceDevConfig({
      secrets: parsedSecrets.data,
    }),
  };
}
