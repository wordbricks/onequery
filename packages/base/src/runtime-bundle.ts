import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import runtimeBundleLayoutJson from "./runtime-bundle.json" with { type: "json" };

type RuntimeBundlePathConfig = {
  relativePath: string;
};

type RuntimeBundleRuntimeEntryConfig = RuntimeBundlePathConfig & {
  requiredFile?: string;
};

type RuntimeAssetBuildSource<FileRole extends string> =
  | {
      kind: "package-entrypoint-directory";
      packageSpecifier: string;
    }
  | {
      kind: "resolved-specifier-map";
      specifiersByFileRole: Readonly<Record<FileRole, string>>;
    };

type RuntimeAssetFileConfig = {
  filename: string;
};

type RuntimeAssetFamilyConfig<FileRole extends string> = {
  buildOwnerPackage: string;
  buildSource: RuntimeAssetBuildSource<FileRole>;
  files: Readonly<Record<FileRole, RuntimeAssetFileConfig>>;
  packagedPath: string;
};

export type RuntimeBundleDirectoryId = "cli" | "server";
export type RuntimeBundleEntryId = "migrations" | "webDist";
type PgliteRuntimeAssetFileRole = "fsBundle" | "initdbWasm" | "pgliteWasm";
type SqlParserRuntimeAssetFileRole = "wasm";
export type RuntimeAssetFamilyId = "pglite" | "sqlParser";
export type RuntimeAssetEnvironment = Record<string, string | undefined>;
export type RuntimeAssetFileRole<Family extends RuntimeAssetFamilyId> =
  Family extends "pglite"
    ? PgliteRuntimeAssetFileRole
    : SqlParserRuntimeAssetFileRole;

type RuntimeBundleLayout = {
  directories: Record<RuntimeBundleDirectoryId, RuntimeBundlePathConfig>;
  manifestVersion: number;
  runtimeEntries: {
    migrations: RuntimeBundleRuntimeEntryConfig;
    webDist: RuntimeBundleRuntimeEntryConfig & {
      requiredFile: string;
    };
  };
  runtimeRootEnvVar: string;
  runtimeAssetFamilies: {
    pglite: RuntimeAssetFamilyConfig<PgliteRuntimeAssetFileRole>;
    sqlParser: RuntimeAssetFamilyConfig<SqlParserRuntimeAssetFileRole>;
  };
};

const runtimeBundleLayout = runtimeBundleLayoutJson as RuntimeBundleLayout;

export const RUNTIME_BUNDLE_LAYOUT = runtimeBundleLayout;
export const ONEQUERY_RUNTIME_ROOT_ENV_VAR =
  RUNTIME_BUNDLE_LAYOUT.runtimeRootEnvVar;
export const RUNTIME_BUNDLE_SPEC_FILENAME = "runtime-bundle.json";

export function getRuntimeAssetFamilyIds(): RuntimeAssetFamilyId[] {
  return Object.keys(
    RUNTIME_BUNDLE_LAYOUT.runtimeAssetFamilies
  ) as RuntimeAssetFamilyId[];
}

export function getRuntimeAssetFamilyConfig<
  Family extends RuntimeAssetFamilyId,
>(family: Family): RuntimeBundleLayout["runtimeAssetFamilies"][Family] {
  return RUNTIME_BUNDLE_LAYOUT.runtimeAssetFamilies[family];
}

export function getRuntimeBundleDirectoryConfig<
  Directory extends RuntimeBundleDirectoryId,
>(directory: Directory): RuntimeBundleLayout["directories"][Directory] {
  return RUNTIME_BUNDLE_LAYOUT.directories[directory];
}

export function getRuntimeBundleEntryConfig<Entry extends RuntimeBundleEntryId>(
  entry: Entry
): RuntimeBundleLayout["runtimeEntries"][Entry] {
  return RUNTIME_BUNDLE_LAYOUT.runtimeEntries[entry];
}

export function normalizeNonEmptyEnvValue(
  value: string | undefined
): string | null {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export function resolveRuntimeRoot(
  processEnv: RuntimeAssetEnvironment
): string | null {
  return normalizeNonEmptyEnvValue(processEnv[ONEQUERY_RUNTIME_ROOT_ENV_VAR]);
}

export function resolveRuntimeBundleSpecSourcePath(): string {
  return fileURLToPath(new URL("./runtime-bundle.json", import.meta.url));
}

export function resolvePackagedRuntimeBundleDirectory<
  Directory extends RuntimeBundleDirectoryId,
>(runtimeRoot: string, directory: Directory): string {
  return resolve(
    runtimeRoot,
    getRuntimeBundleDirectoryConfig(directory).relativePath
  );
}

export function resolvePackagedRuntimeEntryDir<
  Entry extends RuntimeBundleEntryId,
>(runtimeRoot: string, entry: Entry): string {
  return resolve(runtimeRoot, getRuntimeBundleEntryConfig(entry).relativePath);
}

export function resolvePackagedRuntimeAssetDir<
  Family extends RuntimeAssetFamilyId,
>(runtimeRoot: string, family: Family): string {
  return resolve(runtimeRoot, getRuntimeAssetFamilyConfig(family).packagedPath);
}

export function resolvePackagedRuntimeAssetPath<
  Family extends RuntimeAssetFamilyId,
>(
  runtimeRoot: string,
  family: Family,
  fileRole: RuntimeAssetFileRole<Family>
): string {
  const familyConfig = getRuntimeAssetFamilyConfig(family);
  const fileConfig = familyConfig.files[
    fileRole as keyof typeof familyConfig.files
  ] as RuntimeAssetFileConfig;
  return resolve(
    resolvePackagedRuntimeAssetDir(runtimeRoot, family),
    fileConfig.filename
  );
}
