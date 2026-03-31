import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PGliteOptions } from "@electric-sql/pglite";

export const PGLITE_ASSET_DIR_ENV_VAR = "ONEQUERY_PGLITE_ASSET_DIR";
export const PGLITE_RUNTIME_ROOT_ENV_VAR = "ONEQUERY_RUNTIME_ROOT";
export const PACKAGED_PGLITE_DIR_SEGMENTS = ["runtime", "pglite"] as const;
export const PGLITE_RUNTIME_ASSET_FILENAMES = [
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

export function isPgliteConnectionString(connectionString: string): boolean {
  return (
    connectionString === "memory://" ||
    connectionString.startsWith("pglite:") ||
    connectionString.startsWith("pglite://")
  );
}

export function resolvePgliteDataDir(connectionString: string): string {
  if (connectionString === "memory://") {
    return connectionString;
  }

  if (connectionString.startsWith("pglite://")) {
    return connectionString.slice("pglite://".length);
  }

  if (connectionString.startsWith("pglite:")) {
    return connectionString.slice("pglite:".length);
  }

  throw new Error(`Unsupported PGlite connection string: ${connectionString}`);
}

export function ensurePgliteDataDir(connectionString: string): string {
  const dataDir = resolvePgliteDataDir(connectionString);

  if (dataDir !== "memory://") {
    mkdirSync(dataDir, {
      recursive: true,
    });
  }

  return dataDir;
}

export function resolvePackagedPgliteAssetDir(runtimeRoot: string): string {
  return resolve(runtimeRoot, ...PACKAGED_PGLITE_DIR_SEGMENTS);
}

export function resolvePgliteRuntimeOptions(
  processEnv: NodeJS.ProcessEnv = process.env
): PGliteRuntimeOptions | undefined {
  const explicitAssetDir = normalizeNonEmptyEnvValue(
    processEnv[PGLITE_ASSET_DIR_ENV_VAR]
  );
  const runtimeRoot = normalizeNonEmptyEnvValue(
    processEnv[PGLITE_RUNTIME_ROOT_ENV_VAR]
  );

  if (!explicitAssetDir && !runtimeRoot) {
    cachedAssetDir = null;
    cachedOptions = undefined;
    return undefined;
  }

  const assetDir = resolvePgliteAssetDir(processEnv);
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
): string {
  const explicitAssetDir = normalizeNonEmptyEnvValue(
    processEnv[PGLITE_ASSET_DIR_ENV_VAR]
  );
  if (explicitAssetDir) {
    return requirePgliteAssets(
      resolve(explicitAssetDir),
      `${PGLITE_ASSET_DIR_ENV_VAR}=${explicitAssetDir}`
    );
  }

  const runtimeRoot = normalizeNonEmptyEnvValue(
    processEnv[PGLITE_RUNTIME_ROOT_ENV_VAR]
  );
  if (!runtimeRoot) {
    throw new Error(
      "PGlite runtime assets are unavailable because no packaged runtime root was provided"
    );
  }

  const packagedAssetDir = resolvePackagedPgliteAssetDir(runtimeRoot);
  return requirePgliteAssets(
    packagedAssetDir,
    `${PGLITE_RUNTIME_ROOT_ENV_VAR}=${runtimeRoot}`
  );
}

function normalizeNonEmptyEnvValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function requirePgliteAssets(assetDir: string, source: string): string {
  const missingAssets = PGLITE_RUNTIME_ASSET_FILENAMES.filter(
    (filename) => !existsSync(resolve(assetDir, filename))
  );
  if (missingAssets.length === 0) {
    return assetDir;
  }

  throw new Error(
    `Incomplete packaged PGlite runtime for ${source}; missing ${missingAssets.join(", ")} in ${assetDir}`
  );
}
