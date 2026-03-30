import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolvePgliteAssetDir,
  resolvePgliteRuntimeOptions,
} from "./pglite-assets";

const MINIMAL_WASM_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
]);

const originalAssetDir = process.env.ONEQUERY_PGLITE_ASSET_DIR;
const originalRuntimeRoot = process.env.ONEQUERY_RUNTIME_ROOT;

function writePgliteAssetFixtures(assetDir: string) {
  mkdirSync(assetDir, { recursive: true });
  writeFileSync(join(assetDir, "pglite.wasm"), MINIMAL_WASM_MODULE);
  writeFileSync(join(assetDir, "initdb.wasm"), MINIMAL_WASM_MODULE);
  writeFileSync(join(assetDir, "pglite.data"), new Uint8Array([1, 2, 3, 4]));
}

describe("PGlite runtime assets", () => {
  afterEach(() => {
    if (originalAssetDir === undefined) {
      delete process.env.ONEQUERY_PGLITE_ASSET_DIR;
    } else {
      process.env.ONEQUERY_PGLITE_ASSET_DIR = originalAssetDir;
    }

    if (originalRuntimeRoot === undefined) {
      delete process.env.ONEQUERY_RUNTIME_ROOT;
    } else {
      process.env.ONEQUERY_RUNTIME_ROOT = originalRuntimeRoot;
    }
  });

  it("loads packaged runtime assets from an explicit asset directory", async () => {
    const assetDir = mkdtempSync(join(tmpdir(), "onequery-pglite-assets-"));
    writePgliteAssetFixtures(assetDir);

    const options = resolvePgliteRuntimeOptions({
      ONEQUERY_PGLITE_ASSET_DIR: assetDir,
    });

    expect(options).toBeDefined();
    expect(options?.pgliteWasmModule).toBeInstanceOf(WebAssembly.Module);
    expect(options?.initdbWasmModule).toBeInstanceOf(WebAssembly.Module);
    await expect(options?.fsBundle?.arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]).buffer
    );
  });

  it("falls back to runtime-root packaged assets when the explicit env is absent", () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), "onequery-runtime-root-"));
    const assetDir = join(runtimeRoot, "runtime", "pglite");
    writePgliteAssetFixtures(assetDir);

    expect(
      resolvePgliteAssetDir({
        ONEQUERY_RUNTIME_ROOT: runtimeRoot,
      })
    ).toBe(assetDir);
  });

  it("returns no runtime options when no packaged assets are available", () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), "onequery-runtime-root-"));

    expect(
      resolvePgliteRuntimeOptions({
        ONEQUERY_RUNTIME_ROOT: runtimeRoot,
      })
    ).toBeUndefined();
  });
});
