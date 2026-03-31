export type ServerLaunchMode = "workspace-dev" | "self-host";

export interface ServerLaunchListenConfig {
  readonly host: string;
  readonly port: number;
}

export type ServerLaunchStorageConfig =
  | {
      readonly kind: "postgres";
      readonly url: string;
    }
  | {
      readonly dir: string;
      readonly kind: "pglite";
    };

export interface ServerLaunchRateLimitConfig {
  readonly enabled: boolean;
  readonly storage: "memory" | "persistent";
}

export interface ServerLaunchSmtpConfig {
  readonly fromEmail: string;
  readonly fromName?: string;
  readonly host: string;
  readonly password?: string;
  readonly port: number;
  readonly secure?: boolean;
  readonly username?: string;
}

export interface ServerLaunchAssetsConfig {
  readonly distDir: string;
}

export interface ServerLaunchRuntimePaths {
  readonly backupsDir: string;
  readonly dataDir: string;
  readonly lockPath: string;
  readonly logsDir: string;
  readonly pidPath: string;
  readonly runDir: string;
}

export interface ServerLaunchConfig {
  readonly assets: ServerLaunchAssetsConfig;
  readonly auth: {
    readonly secret: string;
  };
  readonly connectors: {
    readonly enrollmentToken: string;
  };
  readonly crypto: {
    readonly masterEncryptionKey: string;
  };
  readonly listen: ServerLaunchListenConfig;
  readonly mode: ServerLaunchMode;
  readonly publicOrigin: string;
  readonly rateLimit: ServerLaunchRateLimitConfig;
  readonly runtimePaths?: ServerLaunchRuntimePaths;
  readonly smtp?: ServerLaunchSmtpConfig;
  readonly storage: ServerLaunchStorageConfig;
}
