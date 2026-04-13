import { once } from "node:events";
import { gzipSync } from "node:zlib";

import { create } from "@bufbuild/protobuf";
import type { DescFile, DescMethod, DescService } from "@bufbuild/protobuf";
import {
  Edition,
  EmptySchema,
  FileDescriptorProtoSchema,
  MethodDescriptorProtoSchema,
  MethodOptions_IdempotencyLevel,
  ServiceDescriptorProtoSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { createContextKey, createContextValues } from "@connectrpc/connect";
import type { ContextValues } from "@connectrpc/connect";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { honoConnectMiddleware } from "./index";
import type { HonoNodeBindings } from "./index";

const CONNECT_JSON_HEADERS = {
  "Connect-Protocol-Version": "1",
  "content-type": "application/json",
};

type TestEnv = {
  Bindings: HonoNodeBindings;
};

type TestServiceMethods = Record<
  string,
  Pick<DescMethod, "input" | "methodKind" | "output"> &
    Partial<Pick<DescMethod, "idempotency">>
>;

type TestGenService<TMethods extends TestServiceMethods> = Omit<
  DescService,
  "method"
> & {
  method: {
    [K in keyof TMethods]: TMethods[K] & DescMethod;
  };
};

const TestService = createTestServiceDesc({
  method: {
    getValue: {
      input: EmptySchema,
      methodKind: "unary",
      output: StringValueSchema,
    },
  },
  typeName: "onequery.hono.v1.TestService",
});

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
    onCall?: () => void;
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
        router.service(TestService, {
          async getValue() {
            input.onCall?.();
            return create(StringValueSchema, { value: "ok" });
          },
        });
      },
    })
  );

  return app;
}

describe("hono connect middleware", () => {
  it("matches only the configured request path prefix", async () => {
    const onCall = vi.fn();
    const app = createTestApp({
      onCall,
      requestPathPrefix: "/api/cli",
    });

    await withNodeServer(app, async (baseUrl) => {
      const matchedResponse = await fetch(
        `${baseUrl}/api/cli/onequery.hono.v1.TestService/GetValue`,
        {
          body: "{}",
          headers: CONNECT_JSON_HEADERS,
          method: "POST",
        }
      );

      expect(matchedResponse.status).toBe(200);
      expect(onCall).toHaveBeenCalledTimes(1);

      const unmatchedResponse = await fetch(
        `${baseUrl}/api/cli/x/onequery.hono.v1.TestService/GetValue`,
        {
          body: "{}",
          headers: CONNECT_JSON_HEADERS,
          method: "POST",
        }
      );

      expect(unmatchedResponse.status).toBe(404);
      expect(onCall).toHaveBeenCalledTimes(1);
    });
  });

  it("accepts gzip-compressed connect requests by default", async () => {
    const onCall = vi.fn();
    const app = createTestApp({
      onCall,
    });

    await withNodeServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/onequery.hono.v1.TestService/GetValue`,
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
      expect(onCall).toHaveBeenCalledTimes(1);
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
          `${baseUrl}/onequery.hono.v1.TestService/GetValue`,
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
          router.service(TestService, {
            async getValue(_request, context) {
              seenRequestId(context.values.get(requestContextKey));
              return create(StringValueSchema, { value: "ok" });
            },
          });
        },
      })
    );

    await withNodeServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/onequery.hono.v1.TestService/GetValue`,
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

function createTestServiceDesc<TMethods extends TestServiceMethods>(service: {
  typeName: string;
  method: TMethods;
}): TestGenService<TMethods> {
  const file = {
    dependencies: [],
    deprecated: false,
    edition: Edition.EDITION_2023,
    enums: [],
    extensions: [],
    kind: "file",
    messages: [],
    name: "hono-connect.test.proto",
    proto: create(FileDescriptorProtoSchema),
    services: [] as DescService[],
  } satisfies DescFile;
  const typeNameSeparator = service.typeName.lastIndexOf(".");
  const methods: DescMethod[] = [];
  const serviceDesc = {} as DescService;

  for (const [localName, method] of Object.entries(service.method)) {
    methods.push({
      deprecated: false,
      idempotency:
        method.idempotency ??
        MethodOptions_IdempotencyLevel.IDEMPOTENCY_UNKNOWN,
      input: method.input,
      kind: "rpc",
      localName,
      methodKind: method.methodKind,
      name: localName.charAt(0).toUpperCase() + localName.slice(1),
      output: method.output,
      parent: serviceDesc,
      proto: create(MethodDescriptorProtoSchema),
    });
  }

  Object.assign(serviceDesc, {
    deprecated: false,
    file,
    kind: "service",
    method: Object.fromEntries(
      methods.map((method) => [method.localName, method])
    ),
    methods,
    name:
      typeNameSeparator < 0
        ? service.typeName
        : service.typeName.slice(typeNameSeparator + 1),
    proto: create(ServiceDescriptorProtoSchema),
    typeName: service.typeName,
  });

  file.services.push(serviceDesc);
  return serviceDesc as TestGenService<TMethods>;
}
