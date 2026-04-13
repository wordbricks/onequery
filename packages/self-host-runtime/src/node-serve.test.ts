import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serveWithNode } from "./node-serve";

describe("serveWithNode", () => {
  let startedServer: Awaited<ReturnType<typeof serveWithNode>> | undefined;

  afterEach(async () => {
    if (startedServer) {
      await startedServer.stop(true);
      startedServer = undefined;
    }
  });

  it("passes node bindings through to Hono handlers", async () => {
    const seenBindings = vi.fn();
    const app = new Hono<{
      Bindings: {
        incoming: { httpVersion: string };
        outgoing: object;
      };
    }>();

    app.get("/health", (c) => {
      seenBindings({
        hasIncoming: Boolean(c.env.incoming),
        hasOutgoing: Boolean(c.env.outgoing),
        httpVersion: c.env.incoming.httpVersion,
      });

      return c.json({
        httpVersion: c.env.incoming.httpVersion,
        ok: true,
      });
    });

    startedServer = await serveWithNode({
      fetch: app.fetch.bind(app),
      hostname: "127.0.0.1",
      idleTimeout: 1,
      port: 0,
    });

    const response = await fetch(
      `http://${startedServer.hostname}:${startedServer.port}/health`
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      httpVersion: "1.1",
      ok: true,
    });
    expect(seenBindings).toHaveBeenCalledWith({
      hasIncoming: true,
      hasOutgoing: true,
      httpVersion: "1.1",
    });
  });
});
