import { once } from "node:events";
import { gzipSync } from "node:zlib";

import { create } from "@bufbuild/protobuf";
import { createContextKey, createContextValues } from "@connectrpc/connect";
import type { ContextValues } from "@connectrpc/connect";
import { createAdaptorServer } from "@hono/node-server";
import { honoConnectMiddleware } from "@onequery/hono-connect";
import type { HonoNodeBindings } from "@onequery/hono-connect";
import { Hono } from "hono";
import type { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CliAuthMode,
  GetSessionResponseSchema,
} from "./gen/onequery/cli/v1/auth_pb";
import { CliService } from "./gen/onequery/cli/v1/cli_pb";

const CONNECT_JSON_HEADERS = {
  "Connect-Protocol-Version": "1",
  "content-type": "application/json",
};

type TestEnv = {
  Bindings: HonoNodeBindings;
};

afterEach(() => {
  vi.restoreAllMocks();
});

async function withNodeServer(
  app: Hono<TestEnv>,
  run: (baseUrl: string) => Promise<void>
) {
  const server = createAdaptorServer({
    autoCleanupIncoming: true,
    fetch(request, env) {
      return app.fetch(request, env);
    },
    hostname: "127.0.0.1",
    overrideGlobalObjects: false,
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP listen address for Hono node server test");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

function createTestApp(
  input: {
    contextValues?: (context: Context<TestEnv>) => ContextValues;
    onGetSession?: () => void;
    onOuterError?: () => Response;
    requestPathPrefix?: string;
  } = {}
) {
  const app = new Hono<TestEnv>();
  if (input.onOuterError) {
    app.onError(
      () => input.onOuterError?.() ?? new Response(null, { status: 500 })
    );
  }

  app.use(
    "*",
    honoConnectMiddleware({
      connect: true,
      contextValues: input.contextValues,
      grpc: false,
      grpcWeb: false,
      requestPathPrefix: input.requestPathPrefix,
      routes(router) {
        router.service(CliService, {
          async getSession() {
            input.onGetSession?.();
            return create(GetSessionResponseSchema, {
              authMode: CliAuthMode.BROWSER_SESSION,
            });
          },
        });
      },
    })
  );

  return app;
}

describe("hono connect middleware", () => {
  it("matches only the configured request path prefix", async () => {
    const onGetSession = vi.fn();
    const app = createTestApp({
      onGetSession,
      requestPathPrefix: "/api/cli",
    });

    await withNodeServer(app, async (baseUrl) => {
      const matchedResponse = await fetch(
        `${baseUrl}/api/cli/onequery.cli.v1.CliService/GetSession`,
        {
          body: "{}",
          headers: CONNECT_JSON_HEADERS,
          method: "POST",
        }
      );

      expect(matchedResponse.status).toBe(200);
      expect(onGetSession).toHaveBeenCalledTimes(1);

      const unmatchedResponse = await fetch(
        `${baseUrl}/api/cli/x/onequery.cli.v1.CliService/GetSession`,
        {
          body: "{}",
          headers: CONNECT_JSON_HEADERS,
          method: "POST",
        }
      );

      expect(unmatchedResponse.status).toBe(404);
      expect(onGetSession).toHaveBeenCalledTimes(1);
    });
  });

  it("accepts gzip-compressed connect requests by default", async () => {
    const onGetSession = vi.fn();
    const app = createTestApp({
      onGetSession,
    });

    await withNodeServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/onequery.cli.v1.CliService/GetSession`,
        {
          body: gzipSync(Buffer.from("{}")),
          headers: {
            ...CONNECT_JSON_HEADERS,
            "content-encoding": "gzip",
          },
          method: "POST",
        }
      );

      expect(response.status).toBe(200);
      expect(onGetSession).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps matched-route adapter failures out of the outer hono error pipeline", async () => {
    const outerError = vi.fn(
      () => new Response("outer error", { status: 599 })
    );
    const consoleError = vi.fn();
    const originalConsoleError = console.error;
    console.error = consoleError;
    const app = createTestApp({
      contextValues() {
        throw new Error("context failed");
      },
      onOuterError: outerError,
    });

    try {
      await withNodeServer(app, async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/onequery.cli.v1.CliService/GetSession`,
          {
            body: "{}",
            headers: CONNECT_JSON_HEADERS,
            method: "POST",
          }
        );

        expect(response.status).toBe(500);
        expect(await response.text()).toBe("");
        expect(outerError).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalledTimes(1);
      });
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("passes connect context values from hono into matched handlers", async () => {
    const requestContextKey = createContextKey<string | undefined>(undefined, {
      description: "test-request-context",
    });
    const seenRequestId = vi.fn();
    const app = new Hono<TestEnv>();

    app.use(
      "*",
      honoConnectMiddleware({
        connect: true,
        contextValues(c) {
          return createContextValues().set(
            requestContextKey,
            c.req.header("x-request-id")
          );
        },
        grpc: false,
        grpcWeb: false,
        routes(router) {
          router.service(CliService, {
            async getSession(_request, context) {
              seenRequestId(context.values.get(requestContextKey));
              return create(GetSessionResponseSchema, {
                authMode: CliAuthMode.BROWSER_SESSION,
              });
            },
          });
        },
      })
    );

    await withNodeServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/onequery.cli.v1.CliService/GetSession`,
        {
          body: "{}",
          headers: {
            ...CONNECT_JSON_HEADERS,
            "x-request-id": "req_test",
          },
          method: "POST",
        }
      );

      expect(response.status).toBe(200);
      expect(seenRequestId).toHaveBeenCalledWith("req_test");
    });
  });
});
