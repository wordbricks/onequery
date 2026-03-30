export const API_ROUTE_PREFIX = "/api";
export const BUDGET_API_ROUTE_PREFIX = `${API_ROUTE_PREFIX}/budget`;
export const CLI_API_ROUTE_PREFIX = `${API_ROUTE_PREFIX}/cli`;
export const DEVICE_AUTHORIZATION_API_ROUTE_PREFIX = `${API_ROUTE_PREFIX}/device`;

export const DEFAULT_BUN_RUNTIME_LISTEN_HOST = "127.0.0.1";
export const DEFAULT_BUN_RUNTIME_PORT = 4545;
export const DEFAULT_BUN_SERVER_IDLE_TIMEOUT_SECONDS = 30;

export const RUNTIME_RATE_LIMIT_STORAGE_DIRNAME = "rate-limit";
export const RUNTIME_RATE_LIMIT_API_DIRNAME = "api";
export const RUNTIME_RATE_LIMIT_AUTH_DIRNAME = "auth";

export function isApiRoutePath(path: string): boolean {
  return path === API_ROUTE_PREFIX || path.startsWith(`${API_ROUTE_PREFIX}/`);
}

export function resolveDefaultPublicOrigin(input: {
  listenHost: string;
  port: number;
}): string {
  return `http://${resolveDefaultPublicHost(input.listenHost)}:${input.port}`;
}

export function resolveDefaultPublicHost(listenHost: string): string {
  if (listenHost === "0.0.0.0") {
    return DEFAULT_BUN_RUNTIME_LISTEN_HOST;
  }

  return listenHost;
}

export function toSqliteConnectionString(sqlitePath: string): string {
  return `sqlite:${sqlitePath}`;
}
