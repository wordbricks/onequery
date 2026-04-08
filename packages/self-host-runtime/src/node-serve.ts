import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { StartServerDependencies } from "./index";

type NodeServeOptions = Parameters<StartServerDependencies["serve"]>[0];
type NodeReadableStream = Parameters<typeof Readable.fromWeb>[0];
type HeadersWithGetSetCookie = Headers & {
  getSetCookie?: () => string[];
};

export async function serveWithNode(
  options: NodeServeOptions
): Promise<Awaited<ReturnType<StartServerDependencies["serve"]>>> {
  const server = createServer((req, res) => {
    void handleRequest(req, res, options);
  });

  server.keepAliveTimeout = options.idleTimeout * 1000;

  await listen(server, options);

  return {
    hostname: options.hostname,
    port: options.port,
    stop(closeActiveConnections) {
      server.close(() => undefined);

      if (closeActiveConnections) {
        server.closeAllConnections?.();
        server.closeIdleConnections?.();
      }
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: NodeServeOptions
): Promise<void> {
  try {
    const response = await options.fetch(
      createNodeRequest(req, `${options.hostname}:${options.port}`)
    );
    await writeNodeResponse(res, response);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(error instanceof Error ? error.message : "Unhandled server error");
  }
}

function createNodeRequest(
  req: IncomingMessage,
  fallbackHost: string
): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry);
      }
      continue;
    }

    headers.append(name, value);
  }

  const url = new URL(
    req.url ?? "/",
    `http://${headers.get("host") ?? fallbackHost}`
  );
  const init: RequestInit & { duplex?: "half" } = {
    headers,
    method: req.method,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req) as unknown as BodyInit;
    init.duplex = "half";
  }

  return new Request(url, init);
}

async function writeNodeResponse(
  res: ServerResponse,
  response: Response
): Promise<void> {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;

  for (const [name, value] of response.headers.entries()) {
    if (name === "set-cookie") {
      continue;
    }

    res.setHeader(name, value);
  }

  const setCookieValues = readSetCookieValues(response.headers);
  if (setCookieValues.length > 0) {
    res.setHeader("set-cookie", setCookieValues);
  }

  if (!response.body) {
    res.end();
    return;
  }

  await pipeline(
    Readable.fromWeb(response.body as unknown as NodeReadableStream),
    res
  );
}

function readSetCookieValues(headers: Headers): string[] {
  const values = (headers as HeadersWithGetSetCookie).getSetCookie?.();
  if (Array.isArray(values) && values.length > 0) {
    return values;
  }

  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

async function listen(
  server: ReturnType<typeof createServer>,
  options: Pick<NodeServeOptions, "hostname" | "port">
): Promise<void> {
  server.listen(options.port, options.hostname);

  try {
    await Promise.race([
      once(server, "listening").then(() => undefined),
      once(server, "error").then(([error]) => {
        throw error;
      }),
    ]);
  } catch (error) {
    server.close();
    throw error;
  }
}
