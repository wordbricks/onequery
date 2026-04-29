import { decodeMasterEncryptionKey } from "@onequery/config/server-launch";
import type { ServerLaunchConfig } from "@onequery/config/server-launch";

import type { AuthEmailDeliveryConfig } from "./lib/email-delivery";

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
    readonly masterEncryptionKey: Uint8Array;
  };
  readonly listen: ServerLaunchConfig["listen"];
  readonly publicOrigin: string;
  readonly rateLimit: {
    readonly api: {
      readonly storage: ServerLaunchConfig["rateLimit"]["api"]["storage"];
    };
    readonly enabled: boolean;
  };
  readonly runtimePaths: ServerLaunchConfig["runtimePaths"];
  readonly storage: ServerRuntimeStorageConfig;
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
  launchConfig: ServerLaunchConfig
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
      masterEncryptionKey: decodeMasterEncryptionKey(
        launchConfig.crypto.masterEncryptionKey
      ),
    },
    listen: launchConfig.listen,
    publicOrigin: launchConfig.publicOrigin,
    rateLimit: {
      api: {
        storage: launchConfig.rateLimit.api.storage,
      },
      enabled: launchConfig.rateLimit.enabled,
    },
    runtimePaths: launchConfig.runtimePaths,
    storage: resolveStorageConfig(launchConfig),
  };
}
