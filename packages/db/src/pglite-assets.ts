import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PGliteOptions } from "@electric-sql/pglite";

const PGLITE_ASSET_DIR_ENV_VAR = "ONEQUERY_PGLITE_ASSET_DIR";
const RUNTIME_ROOT_ENV_VAR = "ONEQUERY_RUNTIME_ROOT";
const PACKAGED_PGLITE_DIR_SEGMENTS = ["runtime", "pglite"] as const;
const PGLITE_ASSET_FILENAMES = [
  "pglite.wasm",
  "initdb.wasm",
  "pglite.data",
] as const;

type PGliteRuntimeOptions = Pick<
  PGliteOptions,
  "fsBundle" | "initdbWasmModule" | "pgliteWasmModule"
>;

let cachedAssetDir: string | null | undefined;
let cachedOptions: PGliteRuntimeOptions | undefined;

export function resolvePgliteRuntimeOptions(
  processEnv: NodeJS.ProcessEnv = process.env
): PGliteRuntimeOptions | undefined {
  const assetDir = resolvePgliteAssetDir(processEnv);
  if (!assetDir) {
    cachedAssetDir = null;
    cachedOptions = undefined;
    return undefined;
  }

  if (cachedAssetDir === assetDir && cachedOptions) {
    return cachedOptions;
  }

  const pgliteWasmPath = resolve(assetDir, "pglite.wasm");
  const initdbWasmPath = resolve(assetDir, "initdb.wasm");
  const fsBundlePath = resolve(assetDir, "pglite.data");

  const options = {
    fsBundle: new Blob([readFileSync(fsBundlePath)]),
    initdbWasmModule: new WebAssembly.Module(readFileSync(initdbWasmPath)),
    // Comment: compiled Bun executables resolve PGlite's internal asset URLs
    // into `/$bunfs/root`, so load the wasm bundle from the packaged runtime.
    pgliteWasmModule: new WebAssembly.Module(readFileSync(pgliteWasmPath)),
  } satisfies PGliteRuntimeOptions;

  cachedAssetDir = assetDir;
  cachedOptions = options;
  return options;
}

export function resolvePgliteAssetDir(
  processEnv: NodeJS.ProcessEnv = process.env
): string | null {
  const explicitAssetDir = normalizeNonEmptyEnvValue(
    processEnv[PGLITE_ASSET_DIR_ENV_VAR]
  );
  if (explicitAssetDir) {
    const resolvedAssetDir = resolve(explicitAssetDir);
    return hasRequiredPgliteAssets(resolvedAssetDir) ? resolvedAssetDir : null;
  }

  const runtimeRoot = normalizeNonEmptyEnvValue(
    processEnv[RUNTIME_ROOT_ENV_VAR]
  );
  if (!runtimeRoot) {
    return null;
  }

  const packagedAssetDir = resolve(
    runtimeRoot,
    ...PACKAGED_PGLITE_DIR_SEGMENTS
  );
  return hasRequiredPgliteAssets(packagedAssetDir) ? packagedAssetDir : null;
}

function normalizeNonEmptyEnvValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function hasRequiredPgliteAssets(assetDir: string): boolean {
  return PGLITE_ASSET_FILENAMES.every((filename) =>
    existsSync(resolve(assetDir, filename))
  );
}
