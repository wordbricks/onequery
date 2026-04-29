import {
  serverLaunchApiRateLimitStorageLabel,
  viewServerLaunchCommonConfig,
  viewServerLaunchConfig,
} from "@onequery/config/server-launch";
import type {
  ServerLaunchConfig,
  ServerLaunchRateLimitStorage,
  ServerLaunchRuntimePathsConfig,
  ServerLaunchSmtpConfig,
  ServerLaunchStorageConfig,
} from "@onequery/config/server-launch";

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
  readonly listen: {
    readonly host: string;
    readonly port: number;
  };
  readonly publicOrigin: string;
  readonly rateLimit: {
    readonly api: {
      readonly storage: ServerLaunchRateLimitStorage;
    };
    readonly enabled: boolean;
  };
  readonly runtimePaths?: ServerLaunchRuntimePathsConfig;
  readonly storage: ServerRuntimeStorageConfig;
}

function resolveStorageConfig(
  storage: ServerLaunchStorageConfig
): ServerRuntimeStorageConfig {
  switch (storage.kind.case) {
    case "postgres":
      return {
        connectionString: storage.kind.value.url,
        kind: "postgres",
        url: storage.kind.value.url,
      };
    case "pglite":
      return {
        connectionString: `pglite:${storage.kind.value.dir}`,
        dir: storage.kind.value.dir,
        kind: "pglite",
      };
    case undefined:
      throw new Error(
        "Invalid launch config from runtime.\n- storage.kind: Required oneof is missing."
      );
    default:
      throw new Error(
        "Invalid launch config from runtime.\n- storage.kind: Unsupported storage kind."
      );
  }
}

function resolveEmailDelivery(
  publicOrigin: string,
  smtp: ServerLaunchSmtpConfig | undefined
): AuthEmailDeliveryConfig {
  if (!smtp) {
    return {
      baseURL: publicOrigin,
    };
  }

  return {
    baseURL: publicOrigin,
    smtp: {
      fromEmail: smtp.fromEmail,
      fromName: optionalString(smtp.fromName),
      host: smtp.host,
      password: optionalString(smtp.password),
      port: smtp.port,
      secure: smtp.secure,
      username: optionalString(smtp.username),
    },
  };
}

export function createServerRuntimeConfig(
  launchConfig: ServerLaunchConfig
): ServerRuntimeConfig {
  const launchView = viewServerLaunchConfig(launchConfig, "runtime");
  const commonView = viewServerLaunchCommonConfig(launchView.common, "runtime");

  return {
    auth: {
      baseURL: commonView.common.publicOrigin,
      emailDelivery: resolveEmailDelivery(
        commonView.common.publicOrigin,
        commonView.common.smtp
      ),
      secret: commonView.auth.secret,
    },
    connectors: {
      enrollmentToken: commonView.connectors.enrollmentToken,
    },
    crypto: {
      masterEncryptionKey: commonView.crypto.masterEncryptionKey,
    },
    listen: {
      host: commonView.listen.host,
      port: commonView.listen.port,
    },
    publicOrigin: commonView.common.publicOrigin,
    rateLimit: {
      api: {
        storage: serverLaunchApiRateLimitStorageLabel(
          commonView.apiRateLimit.storage
        ),
      },
      enabled: commonView.rateLimit.enabled,
    },
    runtimePaths:
      launchView.mode === "self-host" ? launchView.runtimePaths : undefined,
    storage: resolveStorageConfig(commonView.storage),
  };
}

function optionalString(value: string): string | undefined {
  return value.length === 0 ? undefined : value;
}
