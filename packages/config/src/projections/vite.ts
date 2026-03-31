import type { ResolvedWorkspaceDevConfig } from "../workspace-dev";

export interface ViteDevServerProjection {
  readonly apiProxyTarget: string;
  readonly port: number;
}

export function projectViteDevServerConfig(
  workspaceDev: ResolvedWorkspaceDevConfig
): ViteDevServerProjection {
  return {
    apiProxyTarget: workspaceDev.api.origin,
    port: workspaceDev.browser.port,
  };
}
