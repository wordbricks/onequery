import { createContextValues } from "@connectrpc/connect";
import type { ContextValues } from "@connectrpc/connect";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";

import { createCliRoutes } from "../app";
import type { CreateCliAppOptions } from "../app";
import { logCliEvent, toCliErrorMessage } from "../observability";
import { runCliPersistQueryUsageEffect } from "../query/effects";
import { createCliConnectContextValues } from "./context";
import {
  createCliConnectHandler,
  listCliConnectRequestPaths,
} from "./node-adapter";
import { recoverPendingQueryUsagePersistenceEffects } from "./service/query/workflow";

interface CreateCliRouteOptions extends CreateCliAppOptions {
  requestPathPrefix?: string;
}

export function createCliConnectRoutes(input: CreateCliRouteOptions) {
  const app = createCliRoutes(input);
  scheduleQueryUsagePersistenceRecovery(input);
  const contextValuesByRequest = new WeakMap<object, ContextValues>();
  const connectHandler = createCliConnectHandler({
    contextValues(request) {
      return contextValuesByRequest.get(request) ?? createContextValues();
    },
    requestPathPrefix: input.requestPathPrefix,
  });

  for (const requestPath of listCliConnectRequestPaths()) {
    app.all(requestPath, async (c) => {
      const request = c.env.incoming;

      // Comment: connectNodeAdapter creates ContextValues from the raw Node
      // request, so bridge the active Hono context through a per-request map.
      contextValuesByRequest.set(request, createCliConnectContextValues(c));

      try {
        // Comment: the outer runtime app owns the `/api/cli` mount, so keep
        // the Connect request path prefix explicit instead of inferring it from
        // the child Hono app.
        connectHandler(request, c.env.outgoing);
      } finally {
        contextValuesByRequest.delete(request);
      }

      return RESPONSE_ALREADY_SENT;
    });
  }

  return app;
}

function scheduleQueryUsagePersistenceRecovery(input: CreateCliRouteOptions) {
  queueMicrotask(() => {
    void recoverPendingQueryUsagePersistenceEffects({
      actorSnapshot: {
        authMode: null,
        email: null,
        membershipRoles: [],
        userId: null,
      },
      db: input.storage.db,
      dispatch: {
        persistUsage: (effect) =>
          runCliPersistQueryUsageEffect({
            db: input.storage.db,
            effect,
          }),
      },
      requestId: "startup-query-usage-recovery",
    }).catch((error: unknown) => {
      logCliEvent({
        details: {
          error: toCliErrorMessage(error),
        },
        event: "cli.query.usage_persistence_startup_recovery_failed",
        level: "warn",
      });
    });
  });
}
