import { once } from "node:events";

import { createAdaptorServer } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";

import type { StartServerDependencies } from "./index";

type NodeServeOptions = Parameters<StartServerDependencies["serve"]>[0];

export async function serveWithNode(
  options: NodeServeOptions
): Promise<Awaited<ReturnType<StartServerDependencies["serve"]>>> {
  const server = createAdaptorServer({
    autoCleanupIncoming: true,
    fetch: options.fetch,
    hostname: options.hostname,
    overrideGlobalObjects: false,
  });

  if ("keepAliveTimeout" in server) {
    server.keepAliveTimeout = options.idleTimeout * 1000;
  }

  await listen(server, options);
  const address = server.address();
  const resolvedAddress =
    address && typeof address === "object" ? address : undefined;

  return {
    hostname: resolvedAddress?.address ?? options.hostname,
    port: resolvedAddress?.port ?? options.port,
    stop(closeActiveConnections) {
      return new Promise<void>((resolve, reject) => {
        try {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });

          if (closeActiveConnections) {
            if ("closeAllConnections" in server) {
              server.closeAllConnections?.();
            }
            if ("closeIdleConnections" in server) {
              server.closeIdleConnections?.();
            }
          }
        } catch (error) {
          reject(error);
        }
      });
    },
  };
}

async function listen(
  server: ServerType,
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
