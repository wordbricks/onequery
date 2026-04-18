import type {
  ConnectRouter,
  ConnectRouterOptions,
  ContextValues,
} from "@connectrpc/connect";
import { Code, ConnectError, createConnectRouter } from "@connectrpc/connect";
import type {
  UniversalHandler,
  UniversalServerRequest,
  UniversalServerResponse,
} from "@connectrpc/connect/protocol";
import { createValidateInterceptor } from "@connectrpc/validate";
import type { Context, Env } from "hono";
import { createMiddleware } from "hono/factory";

// Comment: Cloudflare Workers don't expose Node incoming/outgoing bindings, so
// this adapter bridges the Connect universal handler contract directly to the
// Hono `fetch` request/response pair instead of using `@connectrpc/connect-node`.
interface HonoConnectMiddlewareOptions<
  E extends Env,
> extends ConnectRouterOptions {
  routes: (router: ConnectRouter) => void;
  requestPathPrefix?: string;
  contextValues?: (c: Context<E>) => ContextValues;
}

export function honoConnectMiddleware<E extends Env>(
  options: HonoConnectMiddlewareOptions<E>
) {
  const router = createConnectRouter({
    connect: true,
    grpc: false,
    grpcWeb: false,
    interceptors: [createValidateInterceptor()],
    ...options,
  });
  options.routes(router);

  const prefix = options.requestPathPrefix ?? "";
  const paths = new Map<string, UniversalHandler>();
  for (const handler of router.handlers) {
    paths.set(prefix + handler.requestPath, handler);
  }

  return createMiddleware<E>(async (c, next) => {
    const handler = paths.get(c.req.path);
    if (!handler) {
      return next();
    }

    const contextValues = options.contextValues?.(c);
    const universalRequest = fetchRequestToUniversal(c.req.raw, contextValues);
    try {
      const universalResponse = await handler(universalRequest);
      return universalResponseToFetch(universalResponse);
    } catch (reason) {
      if (ConnectError.from(reason).code === Code.Aborted) {
        return new Response(null, { status: 499 });
      }
      throw reason;
    }
  });
}

function fetchRequestToUniversal(
  request: Request,
  contextValues?: ContextValues
): UniversalServerRequest {
  return {
    httpVersion: "1.1",
    url: request.url,
    method: request.method,
    header: request.headers,
    body: readableStreamToAsyncIterable(request.body),
    signal: request.signal,
    contextValues,
  };
}

function universalResponseToFetch(response: UniversalServerResponse): Response {
  const body = response.body ? asyncIterableToStream(response.body) : null;
  return new Response(body, {
    status: response.status,
    headers: response.header,
  });
}

function readableStreamToAsyncIterable(
  stream: ReadableStream<Uint8Array> | null
): AsyncIterable<Uint8Array> {
  if (stream === null) {
    return emptyAsyncByteStream();
  }
  // Comment: Workers runtimes implement async iteration on ReadableStream, but
  // TS lib types don't promise it, so read the stream manually.
  return {
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            return;
          }
          if (value) {
            yield value;
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

async function* emptyAsyncByteStream(): AsyncIterable<Uint8Array> {}

function asyncIterableToStream(
  iterable: AsyncIterable<Uint8Array>
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of iterable) {
          controller.enqueue(chunk);
        }
        controller.close();
      } catch (reason) {
        controller.error(reason);
      }
    },
  });
}
