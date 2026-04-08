export const CLI_PACKAGE_NAME = "@onequery/cli";
export const CLI_BINARY_NAME = "onequery";
export const CLI_SERVER_BUNDLE_FILENAME = "onequery-server.mjs";
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
  "cli-win32-arm64": {
    optionalDependencyName: "onequery-win32-arm64",
    npmTag: "win32-arm64",
    targetTriple: "aarch64-pc-windows-msvc",
    os: "win32",
    cpu: "arm64",
  },
  "cli-win32-x64": {
    optionalDependencyName: "onequery-win32-x64",
    npmTag: "win32-x64",
    targetTriple: "x86_64-pc-windows-msvc",
    os: "win32",
    cpu: "x64",
  },
};

export const EXTRA_RELEASE_PLATFORM_PACKAGES = {
  // COMMENT: Keep GNU Linux release tarballs available on GitHub Releases
  // without adding glibc-specific optional dependencies to the npm install
  // path. The launcher falls back to these local vendor payloads when present.
  "cli-linux-arm64-gnu": {
    optionalDependencyName: null,
    npmTag: "linux-arm64-gnu",
    targetTriple: "aarch64-unknown-linux-gnu",
    os: "linux",
    cpu: "arm64",
  },
  "cli-linux-x64-gnu": {
    optionalDependencyName: null,
    npmTag: "linux-x64-gnu",
    targetTriple: "x86_64-unknown-linux-gnu",
    os: "linux",
    cpu: "x64",
  },
};

export const RELEASE_PLATFORM_PACKAGES = {
  ...PLATFORM_PACKAGES,
  ...EXTRA_RELEASE_PLATFORM_PACKAGES,
};

export const PLATFORM_PACKAGE_BY_TARGET = Object.fromEntries(
  Object.values(PLATFORM_PACKAGES).map((platformPackage) => [
    platformPackage.targetTriple,
    platformPackage.optionalDependencyName,
  ])
);

export function serverBundleFilenameForTargetTriple(targetTriple) {
  switch (targetTriple) {
    case "aarch64-apple-darwin":
    case "aarch64-unknown-linux-musl":
    case "aarch64-unknown-linux-gnu":
    case "aarch64-pc-windows-msvc":
    case "x86_64-apple-darwin":
    case "x86_64-unknown-linux-musl":
    case "x86_64-unknown-linux-gnu":
    case "x86_64-pc-windows-msvc":
      return CLI_SERVER_BUNDLE_FILENAME;
    default:
      throw new Error(`Unsupported server target triple '${targetTriple}'.`);
  }
}

export function packageStagingDirPrefix(packageName) {
  return `${CLI_STAGE_PACKAGE_DIR_PREFIX}${packageName}-`;
}

export function binaryNameForPlatform(platform, baseName) {
  return platform === "win32" ? `${baseName}.exe` : baseName;
}

export function binaryNameForTargetTriple(targetTriple, baseName) {
  return targetTriple.includes("-windows-") ? `${baseName}.exe` : baseName;
}

export function resolveTargetTripleCandidates(platform, arch) {
  switch (platform) {
    case "linux":
    case "android": {
      switch (arch) {
        case "x64":
          return ["x86_64-unknown-linux-musl", "x86_64-unknown-linux-gnu"];
        case "arm64":
          return ["aarch64-unknown-linux-musl", "aarch64-unknown-linux-gnu"];
        default:
          break;
      }
      break;
    }
    case "darwin": {
      switch (arch) {
        case "x64":
          return ["x86_64-apple-darwin"];
        case "arm64":
          return ["aarch64-apple-darwin"];
        default:
          break;
      }
      break;
    }
    case "win32": {
      switch (arch) {
        case "x64":
          return ["x86_64-pc-windows-msvc"];
        case "arm64":
          return ["aarch64-pc-windows-msvc"];
        default:
          break;
      }
      break;
    }
    default: {
      break;
    }
  }

  throw new Error(`Unsupported platform: ${platform} (${arch})`);
}

export function resolveTargetTriple(platform, arch) {
  return resolveTargetTripleCandidates(platform, arch)[0];
}
