import { loadLocalDevRuntimeSync } from "@onequery/dev-config/runtime";

export interface ViteDevServerConfig {
  readonly apiProxyTarget: string;
  readonly port: number;
}

export function resolveViteDevServerConfig(
  env: NodeJS.ProcessEnv = process.env
): ViteDevServerConfig {
  const runtime = loadLocalDevRuntimeSync({
    env,
  });

  return {
    // Comment: Keep the app-local helper as a thin compatibility shim so Vite's
    // dev server config still has a stable call site while the local runtime
    // truth now lives in @onequery/dev-config.
    apiProxyTarget: runtime.api.origin,
    port: runtime.web.devBrowser.port,
  };
}
