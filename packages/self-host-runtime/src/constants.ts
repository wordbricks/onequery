export const API_ROUTE_PREFIX = "/api";
export const CLI_API_ROUTE_PREFIX = `${API_ROUTE_PREFIX}/cli`;
export const DEVICE_AUTHORIZATION_API_ROUTE_PREFIX = `${API_ROUTE_PREFIX}/device`;

export const DEFAULT_SERVER_IDLE_TIMEOUT_SECONDS = 30;

export const RUNTIME_RATE_LIMIT_STORAGE_DIRNAME = "rate-limit";
export const RUNTIME_RATE_LIMIT_API_DIRNAME = "api";

export function isApiRoutePath(path: string): boolean {
  return path === API_ROUTE_PREFIX || path.startsWith(`${API_ROUTE_PREFIX}/`);
}
