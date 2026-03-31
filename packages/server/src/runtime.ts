import type { ServerLaunchConfig } from "@onequery/config/server-launch";

import type { AuthEmailDeliveryConfig } from "./lib/email-delivery";
import type { RuntimeRateLimitStorage } from "./lib/rate-limit-storage";

export type ServerRuntimeStorageConfig =
  | {
      readonly connectionString: string;
      readonly kind: "postgres";
      readonly url: string;
    }
  | {
      readonly connectionString: string;
      readonly dir: string;
      readonly kind: "pglite";
    };

export interface ServerRuntimeConfig {
  readonly auth: {
    readonly baseURL: string;
    readonly emailDelivery: AuthEmailDeliveryConfig;
    readonly secret: string;
  };
  readonly connectors: {
    readonly enrollmentToken: string;
  };
  readonly crypto: {
    readonly masterEncryptionKey: string;
  };
  readonly listen: ServerLaunchConfig["listen"];
  readonly mode: ServerLaunchConfig["mode"];
  readonly publicOrigin: string;
  readonly rateLimit: {
    readonly enabled: boolean;
    readonly runtimeStorage?: RuntimeRateLimitStorage;
    readonly storage: ServerLaunchConfig["rateLimit"]["storage"];
  };
  readonly runtimePaths: ServerLaunchConfig["runtimePaths"];
  readonly storage: ServerRuntimeStorageConfig;
}

export interface CreateServerRuntimeConfigOptions {
  readonly rateLimitStorage?: RuntimeRateLimitStorage;
}

function resolveStorageConfig(
  launchConfig: ServerLaunchConfig
): ServerRuntimeStorageConfig {
  if (launchConfig.storage.kind === "postgres") {
    return {
      connectionString: launchConfig.storage.url,
      kind: "postgres",
      url: launchConfig.storage.url,
    };
  }

  return {
    connectionString: `pglite:${launchConfig.storage.dir}`,
    dir: launchConfig.storage.dir,
    kind: "pglite",
  };
}

function resolveEmailDelivery(
  launchConfig: ServerLaunchConfig
): AuthEmailDeliveryConfig {
  if (!launchConfig.smtp) {
    return {
      baseURL: launchConfig.publicOrigin,
    };
  }

  return {
    baseURL: launchConfig.publicOrigin,
    smtp: {
      fromEmail: launchConfig.smtp.fromEmail,
      fromName: launchConfig.smtp.fromName,
      host: launchConfig.smtp.host,
      password: launchConfig.smtp.password,
      port: launchConfig.smtp.port,
      secure: launchConfig.smtp.secure ?? false,
      username: launchConfig.smtp.username,
    },
  };
}

export function createServerRuntimeConfig(
  launchConfig: ServerLaunchConfig,
  input: CreateServerRuntimeConfigOptions = {}
): ServerRuntimeConfig {
  return {
    auth: {
      baseURL: launchConfig.publicOrigin,
      emailDelivery: resolveEmailDelivery(launchConfig),
      secret: launchConfig.auth.secret,
    },
    connectors: {
      enrollmentToken: launchConfig.connectors.enrollmentToken,
    },
    crypto: {
      masterEncryptionKey: launchConfig.crypto.masterEncryptionKey,
    },
    listen: launchConfig.listen,
    mode: launchConfig.mode,
    publicOrigin: launchConfig.publicOrigin,
    rateLimit: {
      enabled: launchConfig.rateLimit.enabled,
      runtimeStorage: input.rateLimitStorage,
      storage: launchConfig.rateLimit.storage,
    },
    runtimePaths: launchConfig.runtimePaths,
    storage: resolveStorageConfig(launchConfig),
  };
}
