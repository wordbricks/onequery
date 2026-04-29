import { fromJsonString, toJsonString } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import type { SupervisorIdentity } from "@onequery/proto-runtime/runtime/v1/common_pb";
import {
  ServerLaunchApiRateLimitStorage,
  ServerLaunchConfigSchema,
} from "@onequery/proto-runtime/runtime/v1/launch_pb";
import type {
  SelfHostServerLaunchConfig,
  ServerLaunchApiRateLimitConfig,
  ServerLaunchAssetsConfig,
  ServerLaunchAuthConfig,
  ServerLaunchCommonConfig,
  ServerLaunchConnectorsConfig,
  ServerLaunchConfig,
  ServerLaunchCryptoConfig,
  ServerLaunchListenConfig,
  ServerLaunchMigrationsConfig,
  ServerLaunchRateLimitConfig,
  ServerLaunchRuntimePathsConfig,
  ServerLaunchSmtpConfig,
  ServerLaunchStorageConfig,
  ServerLaunchSupervisorControlConfig,
  ServerLaunchSupervisorControlTransportConfig,
  WorkspaceDevServerLaunchConfig,
} from "@onequery/proto-runtime/runtime/v1/launch_pb";

export { decodeMasterEncryptionKey } from "./shared-secrets";
export {
  ServerLaunchApiRateLimitStorage,
  ServerLaunchConfigSchema,
} from "@onequery/proto-runtime/runtime/v1/launch_pb";
export type {
  SelfHostServerLaunchConfig,
  ServerLaunchCommonConfig,
  ServerLaunchConfig,
  ServerLaunchListenConfig,
  ServerLaunchRuntimePathsConfig,
  ServerLaunchSmtpConfig,
  ServerLaunchStorageConfig,
  ServerLaunchSupervisorControlConfig,
  ServerLaunchSupervisorControlTransportConfig,
  WorkspaceDevServerLaunchConfig,
} from "@onequery/proto-runtime/runtime/v1/launch_pb";

const launchConfigValidator = createValidator();

export type ServerLaunchMode = "self-host" | "workspace-dev";
export type ServerLaunchRateLimitStorage = "memory" | "persistent";

export type ServerLaunchCommonView = {
  apiRateLimit: ServerLaunchApiRateLimitConfig;
  assets: ServerLaunchAssetsConfig;
  auth: ServerLaunchAuthConfig;
  common: ServerLaunchCommonConfig;
  connectors: ServerLaunchConnectorsConfig;
  crypto: ServerLaunchCryptoConfig;
  listen: ServerLaunchListenConfig;
  migrations: ServerLaunchMigrationsConfig;
  rateLimit: ServerLaunchRateLimitConfig;
  storage: ServerLaunchStorageConfig;
};

export type WorkspaceDevServerLaunchView = {
  common: ServerLaunchCommonConfig;
  mode: "workspace-dev";
  workspaceDev: WorkspaceDevServerLaunchConfig;
};

export type SelfHostServerLaunchView = {
  common: ServerLaunchCommonConfig;
  launchId: string;
  mode: "self-host";
  runtimePaths: ServerLaunchRuntimePathsConfig;
  selfHost: SelfHostServerLaunchConfig;
  supervisor: SupervisorIdentity;
  supervisorControl: ServerLaunchSupervisorControlConfig;
};

export type ServerLaunchView =
  | SelfHostServerLaunchView
  | WorkspaceDevServerLaunchView;

function launchConfigError(source: string, message: string): Error {
  return new Error(`Invalid launch config from ${source}.\n- ${message}`);
}

function requiredField<T>(
  value: T | undefined,
  source: string,
  path: string
): T {
  if (value === undefined) {
    throw launchConfigError(source, `${path}: Required field is missing.`);
  }

  return value;
}

export function serverLaunchApiRateLimitStorageLabel(
  storage: ServerLaunchApiRateLimitStorage
): ServerLaunchRateLimitStorage {
  switch (storage) {
    case ServerLaunchApiRateLimitStorage.MEMORY:
      return "memory";
    case ServerLaunchApiRateLimitStorage.PERSISTENT:
      return "persistent";
    case ServerLaunchApiRateLimitStorage.UNSPECIFIED:
      throw launchConfigError(
        "runtime",
        "rateLimit.api.storage: Storage must be specified."
      );
    default:
      throw launchConfigError(
        "runtime",
        `rateLimit.api.storage: Unsupported storage ${storage}.`
      );
  }
}

export function viewServerLaunchConfig(
  value: ServerLaunchConfig,
  source: string
): ServerLaunchView {
  switch (value.profile.case) {
    case "workspaceDev":
      return {
        common: requiredField(
          value.profile.value.common,
          source,
          "workspaceDev.common"
        ),
        mode: "workspace-dev",
        workspaceDev: value.profile.value,
      };
    case "selfHost": {
      const selfHost = value.profile.value;
      return {
        common: requiredField(selfHost.common, source, "selfHost.common"),
        launchId: selfHost.launchId,
        mode: "self-host",
        runtimePaths: requiredField(
          selfHost.runtimePaths,
          source,
          "selfHost.runtimePaths"
        ),
        selfHost,
        supervisor: requiredField(
          selfHost.supervisor,
          source,
          "selfHost.supervisor"
        ),
        supervisorControl: requiredField(
          selfHost.supervisorControl,
          source,
          "selfHost.supervisorControl"
        ),
      };
    }
    case undefined:
      throw launchConfigError(source, "profile: Required oneof is missing.");
    default:
      throw launchConfigError(source, "profile: Unsupported oneof case.");
  }
}

export function viewServerLaunchCommonConfig(
  common: ServerLaunchCommonConfig,
  source: string
): ServerLaunchCommonView {
  const rateLimit = requiredField(common.rateLimit, source, "rateLimit");

  return {
    apiRateLimit: requiredField(rateLimit.api, source, "rateLimit.api"),
    assets: requiredField(common.assets, source, "assets"),
    auth: requiredField(common.auth, source, "auth"),
    common,
    connectors: requiredField(common.connectors, source, "connectors"),
    crypto: requiredField(common.crypto, source, "crypto"),
    listen: requiredField(common.listen, source, "listen"),
    migrations: requiredField(common.migrations, source, "migrations"),
    rateLimit,
    storage: requiredField(common.storage, source, "storage"),
  };
}

export function validateServerLaunchConfig(
  value: ServerLaunchConfig,
  source: string
): ServerLaunchConfig {
  const validation = launchConfigValidator.validate(
    ServerLaunchConfigSchema,
    value
  );
  if (validation.kind !== "valid") {
    throw launchConfigError(source, validation.error.message);
  }

  const view = viewServerLaunchConfig(value, source);
  viewServerLaunchCommonConfig(view.common, source);
  return value;
}

export function decodeServerLaunchConfigJson(
  contents: string,
  source: string
): ServerLaunchConfig {
  let decoded: ServerLaunchConfig;
  try {
    decoded = fromJsonString(ServerLaunchConfigSchema, contents);
  } catch (cause) {
    throw launchConfigError(
      source,
      cause instanceof Error ? cause.message : String(cause)
    );
  }

  return validateServerLaunchConfig(decoded, source);
}

export function encodeServerLaunchConfigJson(
  value: ServerLaunchConfig,
  options: { prettySpaces?: number } = {}
): string {
  validateServerLaunchConfig(value, "runtime");
  return `${toJsonString(ServerLaunchConfigSchema, value, {
    prettySpaces: options.prettySpaces ?? 2,
  })}\n`;
}
