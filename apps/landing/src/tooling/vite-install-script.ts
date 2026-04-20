import type { IncomingMessage, ServerResponse } from "node:http";

// Comment: Vite loads the landing config before workspace package build output
// exists, so the plugin needs the installer package's source-backed export
// instead of the dist-backed root entry.
import {
  createInstallScript,
  INSTALL_SCRIPT_HEADERS,
  INSTALL_SCRIPT_PATH,
} from "@onequery/installer/source";
import type { Plugin } from "vite";

const VITE_REQUEST_BASE_URL = "http://onequery-landing.local";

export interface InstallScriptAsset {
  readonly fileName: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly source: string;
}

export function createInstallScriptAsset(): InstallScriptAsset {
  return {
    fileName: INSTALL_SCRIPT_PATH.slice(1),
    headers: INSTALL_SCRIPT_HEADERS,
    source: createInstallScript(),
  };
}

export function shouldServeInstallScriptRequest(
  request: Pick<IncomingMessage, "method" | "url">
): boolean {
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    new URL(request.url ?? "/", VITE_REQUEST_BASE_URL).pathname ===
      INSTALL_SCRIPT_PATH
  );
}

export function createInstallScriptPlugin(): Plugin {
  const asset = createInstallScriptAsset();

  return {
    name: "onequery-install-script",
    configurePreviewServer(server) {
      registerInstallScriptMiddleware(
        server.middlewares.use.bind(server.middlewares),
        asset
      );
    },
    configureServer(server) {
      registerInstallScriptMiddleware(
        server.middlewares.use.bind(server.middlewares),
        asset
      );
    },
    generateBundle() {
      // Keep the landing asset sourced from the installer package so the
      // website and the runtime-served installer stay byte-for-byte aligned.
      this.emitFile({
        fileName: asset.fileName,
        source: asset.source,
        type: "asset",
      });
    },
  };
}

function registerInstallScriptMiddleware(
  applyMiddleware: (
    middleware: (
      req: IncomingMessage,
      res: ServerResponse,
      next: () => void
    ) => void
  ) => void,
  asset: InstallScriptAsset
): void {
  applyMiddleware((request, response, next) => {
    if (!shouldServeInstallScriptRequest(request)) {
      next();
      return;
    }

    response.statusCode = 200;
    for (const [name, value] of Object.entries(asset.headers)) {
      response.setHeader(name, value);
    }

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    response.end(asset.source);
  });
}
