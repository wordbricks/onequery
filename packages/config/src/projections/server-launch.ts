import { resolve } from "node:path";

import { create } from "@bufbuild/protobuf";
import {
  ServerLaunchApiRateLimitConfigSchema,
  ServerLaunchApiRateLimitStorage,
  ServerLaunchCommonConfigSchema,
  ServerLaunchConfigSchema,
  ServerLaunchRateLimitConfigSchema,
  ServerLaunchStorageConfigSchema,
  WorkspaceDevServerLaunchConfigSchema,
} from "@onequery/proto-runtime/runtime/v1/launch_pb";

import type {
  ServerLaunchConfig,
  ServerLaunchSmtpConfig,
} from "../server-launch";
import { decodeMasterEncryptionKey } from "../server-launch";
import type { ResolvedWorkspaceDevConfig } from "../workspace-dev";

export interface ProjectWorkspaceDevServerLaunchConfigOptions {
  readonly assetDir: string;
  readonly migrationsDir: string;
  readonly storageDir: string;
  readonly smtp?: ServerLaunchSmtpConfig;
}

export function projectWorkspaceDevServerLaunchConfig(
  workspaceDev: ResolvedWorkspaceDevConfig,
  options: ProjectWorkspaceDevServerLaunchConfigOptions
): ServerLaunchConfig {
  return create(ServerLaunchConfigSchema, {
    profile: {
      case: "workspaceDev",
      value: create(WorkspaceDevServerLaunchConfigSchema, {
        common: create(ServerLaunchCommonConfigSchema, {
          assets: {
            distDir: resolve(options.assetDir),
          },
          auth: {
            secret: workspaceDev.auth.secret,
          },
          connectors: {
            enrollmentToken: workspaceDev.connectors.enrollmentToken,
          },
          crypto: {
            masterEncryptionKey: decodeMasterEncryptionKey(
              workspaceDev.crypto.masterEncryptionKey
            ),
          },
          listen: workspaceDev.api.listen,
          migrations: {
            dir: resolve(options.migrationsDir),
          },
          publicOrigin: workspaceDev.publicOrigin,
          rateLimit: create(ServerLaunchRateLimitConfigSchema, {
            api: create(ServerLaunchApiRateLimitConfigSchema, {
              storage: ServerLaunchApiRateLimitStorage.MEMORY,
            }),
            enabled: !workspaceDev.flags.disableRateLimit,
          }),
          ...(options.smtp === undefined ? {} : { smtp: options.smtp }),
          storage: create(ServerLaunchStorageConfigSchema, {
            kind: {
              case: "pglite",
              value: {
                dir: resolve(options.storageDir),
              },
            },
          }),
        }),
      }),
    },
  });
}
