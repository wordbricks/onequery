import {
  PLATFORM_PACKAGES as SHARED_PLATFORM_PACKAGES,
  PLATFORM_PACKAGE_BY_TARGET as SHARED_PLATFORM_PACKAGE_BY_TARGET,
  resolveTargetTriple as resolveSharedTargetTriple,
} from "../bin/package-constants.js";

type TargetTriple =
  | "x86_64-unknown-linux-musl"
  | "aarch64-unknown-linux-musl"
  | "x86_64-apple-darwin"
  | "aarch64-apple-darwin";

type RuntimePlatform = "linux" | "android" | "darwin" | "win32";
type RuntimeArch = "x64" | "arm64";

type PlatformPackage = {
  optionalDependencyName: string;
  npmTag: string;
  targetTriple: TargetTriple;
  os: "linux" | "darwin";
  cpu: "x64" | "arm64";
};

export const PLATFORM_PACKAGES = {
  ...SHARED_PLATFORM_PACKAGES,
} satisfies Record<string, PlatformPackage>;

export const PLATFORM_PACKAGE_BY_TARGET = {
  ...SHARED_PLATFORM_PACKAGE_BY_TARGET,
} satisfies Record<TargetTriple, string>;

export function resolveTargetTriple(
  platform: RuntimePlatform | string,
  arch: RuntimeArch | string
): TargetTriple {
  return resolveSharedTargetTriple(platform, arch) as TargetTriple;
}
