export const CLI_PACKAGE_NAME = "@wordbricks/onequery";
export const CLI_BINARY_NAME = "onequery";
export const CLI_SERVER_BINARY_NAME = "onequery-server";
export const CLI_NPM_TARBALL_PREFIX = "onequery-npm";
export const CLI_NPM_STAGE_DIR_PREFIX = `${CLI_NPM_TARBALL_PREFIX}-stage-`;
export const CLI_NPM_PACK_DIR_PREFIX = `${CLI_NPM_TARBALL_PREFIX}-pack-`;
export const CLI_STAGE_PACKAGE_DIR_PREFIX = "onequery-cli-";

export const PLATFORM_PACKAGES = {
  "cli-darwin-arm64": {
    optionalDependencyName: "onequery-darwin-arm64",
    npmTag: "darwin-arm64",
    targetTriple: "aarch64-apple-darwin",
    os: "darwin",
    cpu: "arm64",
  },
  "cli-darwin-x64": {
    optionalDependencyName: "onequery-darwin-x64",
    npmTag: "darwin-x64",
    targetTriple: "x86_64-apple-darwin",
    os: "darwin",
    cpu: "x64",
  },
  "cli-linux-arm64": {
    optionalDependencyName: "onequery-linux-arm64",
    npmTag: "linux-arm64",
    targetTriple: "aarch64-unknown-linux-musl",
    os: "linux",
    cpu: "arm64",
  },
  "cli-linux-x64": {
    optionalDependencyName: "onequery-linux-x64",
    npmTag: "linux-x64",
    targetTriple: "x86_64-unknown-linux-musl",
    os: "linux",
    cpu: "x64",
  },
};

export const PLATFORM_PACKAGE_BY_TARGET = Object.fromEntries(
  Object.values(PLATFORM_PACKAGES).map((platformPackage) => [
    platformPackage.targetTriple,
    platformPackage.optionalDependencyName,
  ])
);

export const SERVER_COMPILE_TARGET_BY_RUST_TARGET = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "aarch64-unknown-linux-musl": "bun-linux-arm64-musl",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "x86_64-unknown-linux-musl": "bun-linux-x64-musl",
};

export function packageStagingDirPrefix(packageName) {
  return `${CLI_STAGE_PACKAGE_DIR_PREFIX}${packageName}-`;
}

export function resolveTargetTriple(platform, arch) {
  switch (platform) {
    case "linux":
    case "android": {
      switch (arch) {
        case "x64":
          return "x86_64-unknown-linux-musl";
        case "arm64":
          return "aarch64-unknown-linux-musl";
        default:
          break;
      }
      break;
    }
    case "darwin": {
      switch (arch) {
        case "x64":
          return "x86_64-apple-darwin";
        case "arm64":
          return "aarch64-apple-darwin";
        default:
          break;
      }
      break;
    }
    default: {
      break;
    }
  }

  if (platform === "win32") {
    throw new Error(
      "Unsupported platform: win32. The published OneQuery package currently supports macOS and Linux only."
    );
  }

  throw new Error(`Unsupported platform: ${platform} (${arch})`);
}
