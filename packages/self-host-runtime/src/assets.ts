import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

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

type AssetRequestPathResolution =
  | {
      status: "invalid";
    }
  | {
      path: string;
      status: "resolved";
    };

export class SpaBuildOutputMissingError extends TaggedError(
  "SpaBuildOutputMissingError"
)<{
  assetDir: string;
  expectedPath: string;
  message: string;
}>() {}

export type CreateSpaAssetBindingError = SpaBuildOutputMissingError;

export type CreateSpaAssetBindingResult = ResultType<
  AssetBinding,
  CreateSpaAssetBindingError
>;

function hasFileExtension(pathname: string): boolean {
  const lastSlashIndex = pathname.lastIndexOf("/");
  const basename =
    lastSlashIndex >= 0 ? pathname.slice(lastSlashIndex + 1) : pathname;
  return basename.includes(".");
}

function resolveAssetRequestPath(pathname: string): AssetRequestPathResolution {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return {
      status: "invalid",
    };
  }
  const segments = decodedPath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return {
      status: "invalid",
    };
  }

  return {
    path: segments.join("/"),
    status: "resolved",
  };
}

function isReadableFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function getContentType(path: string): string {
  return (
    CONTENT_TYPE_BY_EXTENSION[extname(path).toLowerCase()] ??
    "application/octet-stream"
  );
}

async function createFileResponse(
  path: string,
  request: Request
): Promise<Response> {
  const contentType = getContentType(path);
  const body =
    request.method === "HEAD"
      ? null
      : new Blob([await readFile(path)], { type: contentType });

  return new Response(body, {
    headers: {
      "content-type": contentType,
    },
  });
}

export function getDefaultSpaBuildDir(rootDir: string): string {
  return resolve(rootDir, "apps/web/dist");
}

export function createSpaAssetBindingResult(options: {
  assetDir: string;
}): CreateSpaAssetBindingResult {
  const assetDir = resolve(options.assetDir);
  const spaEntryPath = join(assetDir, "index.html");

  if (!isReadableFile(spaEntryPath)) {
    return Result.err(
      new SpaBuildOutputMissingError({
        assetDir,
        expectedPath: spaEntryPath,
        message: `SPA build output missing: expected ${spaEntryPath}. Build apps/web before starting the packaged server runtime.`,
      })
    );
  }

  return Result.ok({
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
      if (requestPath.status === "invalid") {
        return new Response("Not Found", { status: 404 });
      }

      const candidatePath = requestPath.path
        ? join(assetDir, requestPath.path)
        : spaEntryPath;

      if (requestPath.path && isReadableFile(candidatePath)) {
        return createFileResponse(candidatePath, request);
      }

      if (requestPath.path && hasFileExtension(url.pathname)) {
        return new Response("Not Found", { status: 404 });
      }

      return createFileResponse(spaEntryPath, request);
    },
  });
}

export function createSpaAssetBinding(options: {
  assetDir: string;
}): AssetBinding {
  const assetBinding = createSpaAssetBindingResult(options);

  if (assetBinding.isErr()) {
    throw assetBinding.error;
  }

  return assetBinding.value;
}
