/**
 * Rate limiting middleware using hono-rate-limiter with unstorage.
 *
 * Uses runtime-provided storage when available, with automatic fallback to
 * in-memory storage for tests/local development.
 *
 * Better Auth owns request throttling for `/api/auth/*` and the CLI
 * device-auth proxy routes. This middleware only handles the normal API budget.
 */

import type { MiddlewareHandler } from "hono";
import { rateLimiter, UnstorageStore } from "hono-rate-limiter";

import type { ServerStorage } from "../storage";
import type { SessionVariables } from "./session";

/**
 * Get client IP from request headers with multiple fallbacks.
 * Reverse proxies may add provider-specific headers, but we also check common
 * proxy headers.
 */
function getClientIp(c: {
  req: { header: (name: string) => string | undefined };
}): string {
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) {
    return cfIp;
  }

  const realIp = c.req.header("x-real-ip");
  if (realIp) {
    return realIp;
  }

  const forwardedFor = c.req.header("x-forwarded-for");
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, the first is the client
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  return "anonymous";
}

/**
 * Check if a path should skip rate limiting.
 * Uses normalized path and strict prefix matching to prevent bypass attacks.
 */
function shouldSkipPath(path: string): boolean {
  // Normalize the path to prevent traversal attacks
  const normalizedPath = new URL(path, "http://localhost").pathname;
  const cliDeviceAuthPrefix = "/api/cli/auth/device-authorizations";

  return (
    normalizedPath === "/api/health" ||
    normalizedPath === "/api/webhook" ||
    normalizedPath.startsWith("/api/webhook/") ||
    normalizedPath === "/api/webhooks" ||
    normalizedPath.startsWith("/api/webhooks/") ||
    normalizedPath === cliDeviceAuthPrefix ||
    normalizedPath.startsWith(`${cliDeviceAuthPrefix}/`) ||
    normalizedPath === "/api/auth" ||
    normalizedPath.startsWith("/api/auth/")
  );
}

/**
 * Pre-configured rate limiter for general API endpoints.
 * - 100 requests per minute
 * - Skips health checks, webhooks, and Better Auth-owned routes
 * - Uses user ID for authenticated requests, IP for anonymous
 */
export function apiRateLimiter(input: {
  enabled: boolean;
}): MiddlewareHandler<{
  Variables: SessionVariables;
}> {
  const middlewareCache = new WeakMap<
    ServerStorage,
    MiddlewareHandler<{ Variables: SessionVariables }>
  >();

  return async (c, next) => {
    const storage = c.var.storage;
    let middleware = middlewareCache.get(storage);

    if (!middleware) {
      middleware = rateLimiter({
        windowMs: 60_000, // 1 minute
        limit: 100,
        standardHeaders: "draft-6",
        keyGenerator: (rateLimitContext) => {
          const userId = rateLimitContext.get("session")?.user?.id;
          if (userId) {
            return `user:${userId}`;
          }
          return `ip:${getClientIp(rateLimitContext)}`;
        },
        skip: (rateLimitContext) => {
          if (!input.enabled) {
            return true;
          }
          return shouldSkipPath(rateLimitContext.req.path);
        },
        store: new UnstorageStore({
          prefix: "api:",
          storage: storage.apiRateLimitStorage,
        }),
      });
      middlewareCache.set(storage, middleware);
    }

    return middleware(c, next);
  };
}
