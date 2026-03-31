import {
  projectViteDevServerConfig,
  resolveWorkspaceDev,
} from "@onequery/config";

export interface ViteDevServerConfig {
  readonly apiProxyTarget: string;
  readonly port: number;
}

export function resolveViteDevServerConfig(
  input: {
    readonly rootDir?: string;
  } = {}
): ViteDevServerConfig {
  return projectViteDevServerConfig(
    resolveWorkspaceDev({
      rootDir: input.rootDir,
    })
  );
}
