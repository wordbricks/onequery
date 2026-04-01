export type TargetTriple =
  | "x86_64-unknown-linux-musl"
  | "aarch64-unknown-linux-musl"
  | "x86_64-apple-darwin"
  | "aarch64-apple-darwin"
  | "x86_64-pc-windows-msvc"
  | "aarch64-pc-windows-msvc"
  | "x86_64-unknown-linux-gnu"
  | "aarch64-unknown-linux-gnu";

export type NpmTargetTriple = Exclude<
  TargetTriple,
  "x86_64-unknown-linux-gnu" | "aarch64-unknown-linux-gnu"
>;

export type RuntimePlatform = "linux" | "android" | "darwin" | "win32";
export type RuntimeArch = "x64" | "arm64";

export type PlatformPackage = {
  optionalDependencyName: string;
  npmTag: string;
  targetTriple: NpmTargetTriple;
  os: "linux" | "darwin" | "win32";
  cpu: RuntimeArch;
};

export type ReleasePlatformPackage = {
  optionalDependencyName: string | null;
  npmTag: string;
  targetTriple: TargetTriple;
  os: "linux" | "darwin" | "win32";
  cpu: RuntimeArch;
};

export type ServerBuildPlan = {
  compileTarget: string;
  filename: string;
};

export const CLI_PACKAGE_NAME: "@onequery/cli";
export const CLI_BINARY_NAME: "onequery";
export const CLI_SERVER_BINARY_NAME: "onequery-server";
export const CLI_SERVER_MUSL_BINARY_NAME: "onequery-server-musl";
export const CLI_NPM_TARBALL_PREFIX: "onequery-npm";
export const CLI_NPM_STAGE_DIR_PREFIX: `${typeof CLI_NPM_TARBALL_PREFIX}-stage-`;
export const CLI_NPM_PACK_DIR_PREFIX: `${typeof CLI_NPM_TARBALL_PREFIX}-pack-`;
export const CLI_STAGE_PACKAGE_DIR_PREFIX: "onequery-cli-";

export const PLATFORM_PACKAGES: Record<string, PlatformPackage>;
export const EXTRA_RELEASE_PLATFORM_PACKAGES: Record<
  string,
  ReleasePlatformPackage
>;
export const RELEASE_PLATFORM_PACKAGES: Record<string, ReleasePlatformPackage>;
export const PLATFORM_PACKAGE_BY_TARGET: Record<NpmTargetTriple, string>;

export function serverBuildsForTargetTriple(
  targetTriple: TargetTriple
): ServerBuildPlan[];

export function packageStagingDirPrefix(packageName: string): string;

export function binaryNameForPlatform(
  platform: RuntimePlatform | string,
  baseName: string
): string;

export function binaryNameForTargetTriple(
  targetTriple: TargetTriple | string,
  baseName: string
): string;

export function resolveTargetTripleCandidates(
  platform: RuntimePlatform | string,
  arch: RuntimeArch | string
): TargetTriple[];

export function resolveTargetTriple(
  platform: RuntimePlatform | string,
  arch: RuntimeArch | string
): TargetTriple;
