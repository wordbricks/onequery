import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSpaAssetBinding, getDefaultSpaBuildDir } from "./assets";

const tempDirs: string[] = [];

function createAssetDir() {
  const assetDir = mkdtempSync(
    join(tmpdir(), "onequery-self-host-runtime-assets-")
  );
  tempDirs.push(assetDir);
  mkdirSync(join(assetDir, "assets"), { recursive: true });
  writeFileSync(
    join(assetDir, "index.html"),
    "<!doctype html><div>SPA Shell</div>",
    "utf8"
  );
  writeFileSync(
    join(assetDir, "assets", "app.js"),
    "console.log('app');",
    "utf8"
  );
  return assetDir;
}

function summarizeResponse(response: Response, body: string) {
  return {
    body,
    headers: Object.fromEntries(
      [...response.headers.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    status: response.status,
  };
}

describe("spa asset binding", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const path = tempDirs.pop();
      if (path) {
        rmSync(path, { force: true, recursive: true });
      }
    }
  });

  it("serves built assets and falls back to index.html for client routes", async () => {
    const assetDir = createAssetDir();
    const binding = createSpaAssetBinding({ assetDir });

    const assetResponse = await binding.fetch(
      new Request("http://local/assets/app.js")
    );
    const routeResponse = await binding.fetch(
      new Request("http://local/dashboard")
    );
    const assetBody = await assetResponse.text();
    const routeBody = await routeResponse.text();

    expect({
      asset: summarizeResponse(assetResponse, assetBody),
      route: summarizeResponse(routeResponse, routeBody),
    }).toMatchSnapshot();
  });

  it("returns 404 for missing file-like paths and traversal attempts", async () => {
    const assetDir = createAssetDir();
    const binding = createSpaAssetBinding({ assetDir });

    const missingResponse = await binding.fetch(
      new Request("http://local/assets/missing.js")
    );
    const traversalResponse = await binding.fetch(
      new Request("http://local/%2E%2E/secret.txt")
    );

    expect(missingResponse.status).toBe(404);
    expect(traversalResponse.status).toBe(404);
  });

  it("returns 404 for malformed percent-encoded paths instead of throwing", async () => {
    const assetDir = createAssetDir();
    const binding = createSpaAssetBinding({ assetDir });

    const response = await binding.fetch(new Request("http://local/%E0%A4%A"));

    expect(response.status).toBe(404);
  });

  it("uses apps/web/dist as the workspace-dev build output path", () => {
    expect(getDefaultSpaBuildDir("/workspace/root")).toBe(
      "/workspace/root/apps/web/dist"
    );
  });
});
