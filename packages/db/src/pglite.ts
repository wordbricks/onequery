import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PGliteOptions } from "@electric-sql/pglite";
import {
  getRuntimeAssetFamilyConfig,
  ONEQUERY_RUNTIME_ROOT_ENV_VAR,
  resolvePackagedRuntimeAssetDir,
  resolveRuntimeRoot,
} from "@onequery/base/runtime-bundle";
import type { RuntimeAssetEnvironment } from "@onequery/base/runtime-bundle";

const PGLITE_RUNTIME_ASSET_FAMILY = "pglite";
const PGLITE_RUNTIME_ASSET_CONFIG = getRuntimeAssetFamilyConfig(
  PGLITE_RUNTIME_ASSET_FAMILY
);
const PGLITE_RUNTIME_ASSET_FILES = PGLITE_RUNTIME_ASSET_CONFIG.files;
export const PGLITE_RUNTIME_ASSET_FILENAMES = Object.values(
  PGLITE_RUNTIME_ASSET_FILES
).map(({ filename }) => filename);
const PGLITE_WASM_FILENAME = PGLITE_RUNTIME_ASSET_FILES.pgliteWasm.filename;
const INITDB_WASM_FILENAME = PGLITE_RUNTIME_ASSET_FILES.initdbWasm.filename;
const PGLITE_DATA_FILENAME = PGLITE_RUNTIME_ASSET_FILES.fsBundle.filename;

type PGliteRuntimeOptions = Pick<
  PGliteOptions,
  "fsBundle" | "initdbWasmModule" | "pgliteWasmModule"
>;

type PgliteAssetLookup =
  | {
      kind: "resolved";
      assetDir: string;
    }
  | {
      kind: "unavailable";
      message: string;
    };

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
  return resolvePackagedRuntimeAssetDir(
    runtimeRoot,
    PGLITE_RUNTIME_ASSET_FAMILY
  );
}

export function resolvePgliteRuntimeOptions(
  processEnv: RuntimeAssetEnvironment = process.env
): PGliteRuntimeOptions | undefined {
  const assetLookup = lookupPgliteAssetDir(processEnv);
  if (assetLookup.kind === "unavailable") {
    cachedAssetDir = null;
    cachedOptions = undefined;
    return undefined;
  }

  const { assetDir } = assetLookup;
  if (cachedAssetDir === assetDir && cachedOptions) {
    return cachedOptions;
  }

  const pgliteWasmPath = resolve(assetDir, PGLITE_WASM_FILENAME);
  const initdbWasmPath = resolve(assetDir, INITDB_WASM_FILENAME);
  const fsBundlePath = resolve(assetDir, PGLITE_DATA_FILENAME);

  const options = {
    fsBundle: new Blob([readArrayBufferBackedFile(fsBundlePath)]),
    initdbWasmModule: new WebAssembly.Module(
      readArrayBufferBackedFile(initdbWasmPath)
    ),
    // Comment: the packaged server runtime loads PGlite's wasm assets from the
    // staged runtime directory instead of relying on module-relative URLs.
    pgliteWasmModule: new WebAssembly.Module(
      readArrayBufferBackedFile(pgliteWasmPath)
    ),
  } satisfies PGliteRuntimeOptions;

  cachedAssetDir = assetDir;
  cachedOptions = options;
  return options;
}

function readArrayBufferBackedFile(path: string): Uint8Array<ArrayBuffer> {
  const fileBytes = readFileSync(path);
  const bytes = new Uint8Array(fileBytes.byteLength);
  bytes.set(fileBytes);
  return bytes;
}

export function resolvePgliteAssetDir(
  processEnv: RuntimeAssetEnvironment = process.env
): string {
  const assetLookup = lookupPgliteAssetDir(processEnv);
  if (assetLookup.kind === "resolved") {
    return assetLookup.assetDir;
  }

  throw new Error(assetLookup.message);
}

function lookupPgliteAssetDir(
  processEnv: RuntimeAssetEnvironment
): PgliteAssetLookup {
  const runtimeRoot = resolveRuntimeRoot(processEnv);
  if (!runtimeRoot) {
    return {
      kind: "unavailable",
      message:
        "PGlite runtime assets are unavailable because no packaged runtime root was provided",
    };
  }

  const packagedAssetDir = resolvePackagedPgliteAssetDir(runtimeRoot);
  if (!existsSync(packagedAssetDir)) {
    return {
      kind: "unavailable",
      message: `PGlite runtime assets are unavailable because ${ONEQUERY_RUNTIME_ROOT_ENV_VAR}=${runtimeRoot} does not contain ${PGLITE_RUNTIME_ASSET_CONFIG.packagedPath}`,
    };
  }

  return {
    assetDir: requirePgliteAssets(
      packagedAssetDir,
      `${ONEQUERY_RUNTIME_ROOT_ENV_VAR}=${runtimeRoot}`
    ),
    kind: "resolved",
  };
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
