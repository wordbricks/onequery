import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

type AssetBinding = {
  fetch(request: Request): Promise<Response>;
};

function hasFileExtension(pathname: string): boolean {
  const lastSlashIndex = pathname.lastIndexOf("/");
  const basename =
    lastSlashIndex >= 0 ? pathname.slice(lastSlashIndex + 1) : pathname;
  return basename.includes(".");
}

function resolveAssetRequestPath(pathname: string): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const segments = decodedPath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  return segments.join("/");
}

function isReadableFile(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function getContentType(path: string, explicitType?: string): string {
  if (explicitType && explicitType.length > 0) {
    return explicitType;
  }

  return (
    CONTENT_TYPE_BY_EXTENSION[extname(path).toLowerCase()] ??
    "application/octet-stream"
  );
}

function createFileResponse(path: string, request: Request): Response {
  const bunGlobal = globalThis as typeof globalThis & {
    Bun?: {
      file(path: string): Blob & { type?: string };
    };
  };
  const bunFile = bunGlobal.Bun?.file(path);
  const body =
    request.method === "HEAD"
      ? null
      : (bunFile ??
        new Blob([readFileSync(path)], { type: getContentType(path) }));

  return new Response(body, {
    headers: {
      "content-type": getContentType(path, bunFile?.type),
    },
  });
}

export function getDefaultSpaBuildDir(rootDir: string): string {
  return resolve(rootDir, "apps/web/dist");
}

export function createSpaAssetBinding(options: {
  assetDir: string;
}): AssetBinding {
  const assetDir = resolve(options.assetDir);
  const spaEntryPath = join(assetDir, "index.html");

  if (!isReadableFile(spaEntryPath)) {
    throw new Error(
      `SPA build output missing: expected ${spaEntryPath}. Run \`bun run --cwd apps/web build\` before starting the Bun server.`
    );
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", {
          headers: {
            allow: "GET, HEAD",
          },
          status: 405,
        });
      }

      const requestPath = resolveAssetRequestPath(url.pathname);
      if (requestPath === null) {
        return new Response("Not Found", { status: 404 });
      }

      const candidatePath = requestPath
        ? join(assetDir, requestPath)
        : spaEntryPath;

      if (requestPath && isReadableFile(candidatePath)) {
        return createFileResponse(candidatePath, request);
      }

      if (requestPath && hasFileExtension(url.pathname)) {
        return new Response("Not Found", { status: 404 });
      }

      return createFileResponse(spaEntryPath, request);
    },
  };
}
