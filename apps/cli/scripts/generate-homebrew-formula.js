#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;
const GENERATE_HOMEBREW_FORMULA_OPTIONS = new Set([
  "--version",
  "--repo-owner",
  "--repo-name",
  "--tag-prefix",
  "--output",
  "--darwin-arm64-sha256",
  "--darwin-x64-sha256",
  "--linux-arm64-sha256",
  "--linux-x64-sha256",
  "--help",
  "-h",
]);

const PLATFORM_RELEASES = [
  {
    assetName: "onequery-npm-darwin-arm64.tgz",
    brewScope: ["on_macos", "on_arm"],
    id: "darwinArm64",
    optionName: "darwin-arm64-sha256",
  },
  {
    assetName: "onequery-npm-darwin-x64.tgz",
    brewScope: ["on_macos", "on_intel"],
    id: "darwinX64",
    optionName: "darwin-x64-sha256",
  },
  {
    assetName: "onequery-npm-linux-arm64.tgz",
    brewScope: ["on_linux", "on_arm"],
    id: "linuxArm64",
    optionName: "linux-arm64-sha256",
  },
  {
    assetName: "onequery-npm-linux-x64.tgz",
    brewScope: ["on_linux", "on_intel"],
    id: "linuxX64",
    optionName: "linux-x64-sha256",
  },
];

function versionedReleaseAssetName(assetName, version) {
  return assetName.replace(/\.tgz$/u, `-${version}.tgz`);
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (value === undefined || GENERATE_HOMEBREW_FORMULA_OPTIONS.has(value)) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

function validateSha256(sha256, optionName) {
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(
      `Expected ${optionName} to be a 64-character hexadecimal SHA-256 digest.`
    );
  }

  return sha256.toLowerCase();
}

export function parseArgs(argv) {
  const args = {
    outputPath: null,
    repoName: null,
    repoOwner: null,
    sha256ByPlatform: {},
    tagPrefix: "cli-v",
    version: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--version": {
        args.version = readOptionValue(argv, index, argument);
        index += 1;
        break;
      }
      case "--repo-owner": {
        args.repoOwner = readOptionValue(argv, index, argument);
        index += 1;
        break;
      }
      case "--repo-name": {
        args.repoName = readOptionValue(argv, index, argument);
        index += 1;
        break;
      }
      case "--tag-prefix": {
        args.tagPrefix = readOptionValue(argv, index, argument);
        index += 1;
        break;
      }
      case "--output": {
        args.outputPath = path.resolve(readOptionValue(argv, index, argument));
        index += 1;
        break;
      }
      case "--darwin-arm64-sha256": {
        args.sha256ByPlatform.darwinArm64 = validateSha256(
          readOptionValue(argv, index, argument),
          argument
        );
        index += 1;
        break;
      }
      case "--darwin-x64-sha256": {
        args.sha256ByPlatform.darwinX64 = validateSha256(
          readOptionValue(argv, index, argument),
          argument
        );
        index += 1;
        break;
      }
      case "--linux-arm64-sha256": {
        args.sha256ByPlatform.linuxArm64 = validateSha256(
          readOptionValue(argv, index, argument),
          argument
        );
        index += 1;
        break;
      }
      case "--linux-x64-sha256": {
        args.sha256ByPlatform.linuxX64 = validateSha256(
          readOptionValue(argv, index, argument),
          argument
        );
        index += 1;
        break;
      }
      case "--help":
      case "-h": {
        printHelp();
        process.exit(0);
        return args;
      }
      default: {
        throw new Error(`Unknown argument '${argument}'.`);
      }
    }
  }

  if (!args.version) {
    throw new Error("--version is required.");
  }

  if (!args.repoOwner) {
    throw new Error("--repo-owner is required.");
  }

  if (!args.repoName) {
    throw new Error("--repo-name is required.");
  }

  for (const requiredPlatformId of ["darwinArm64", "darwinX64", "linuxX64"]) {
    if (!args.sha256ByPlatform[requiredPlatformId]) {
      const platformRelease = PLATFORM_RELEASES.find(
        (release) => release.id === requiredPlatformId
      );
      throw new Error(
        `--${platformRelease?.optionName ?? requiredPlatformId} is required.`
      );
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node apps/cli/scripts/generate-homebrew-formula.js --version <version> --repo-owner <owner> --repo-name <repo> --darwin-arm64-sha256 <sha256> --darwin-x64-sha256 <sha256> --linux-x64-sha256 <sha256> [options]

Options:
  --output <path>               Write the generated formula to this path
  --tag-prefix <prefix>         Release tag prefix (default: cli-v)
  --linux-arm64-sha256 <sha>    Optional SHA-256 for Linux arm64 builds
`);
}

function indent(lines, level) {
  const prefix = "  ".repeat(level);
  return lines.map((line) => (line.length === 0 ? line : `${prefix}${line}`));
}

function buildPlatformBlocks({
  platformReleases,
  releaseTag,
  repoOwner,
  repoName,
}) {
  const scopeTree = new Map();

  for (const platformRelease of platformReleases) {
    const [outerScope, innerScope] = platformRelease.brewScope;
    let outerMap = scopeTree.get(outerScope);
    if (!outerMap) {
      outerMap = new Map();
      scopeTree.set(outerScope, outerMap);
    }

    outerMap.set(innerScope, platformRelease);
  }

  const renderedLines = [];
  for (const [outerScope, innerScopes] of scopeTree) {
    renderedLines.push(`${outerScope} do`);

    for (const [innerScope, platformRelease] of innerScopes) {
      renderedLines.push(...indent([`${innerScope} do`], 1));
      renderedLines.push(
        ...indent(
          [
            `url "https://github.com/${repoOwner}/${repoName}/releases/download/${releaseTag}/${platformRelease.assetName}"`,
            `sha256 "${platformRelease.sha256}"`,
          ],
          2
        )
      );
      renderedLines.push(...indent(["end"], 1));
      renderedLines.push("");
    }

    if (renderedLines.at(-1) === "") {
      renderedLines.pop();
    }
    renderedLines.push("end");
    renderedLines.push("");
  }

  if (renderedLines.at(-1) === "") {
    renderedLines.pop();
  }

  return renderedLines;
}

export function buildFormula({
  repoName,
  repoOwner,
  sha256ByPlatform,
  tagPrefix = "cli-v",
  version,
}) {
  const releaseTag = `${tagPrefix}${version}`;
  const includedPlatformReleases = PLATFORM_RELEASES.filter(
    (platformRelease) => sha256ByPlatform[platformRelease.id]
  ).map((platformRelease) => ({
    ...platformRelease,
    assetName: versionedReleaseAssetName(platformRelease.assetName, version),
    sha256: sha256ByPlatform[platformRelease.id],
  }));

  const formulaLines = [
    "# This file is generated by apps/cli/scripts/generate-homebrew-formula.js.",
    "# Do not edit it manually.",
    "",
    "class Onequery < Formula",
    '  desc "CLI for querying and self-hosting OneQuery"',
    '  homepage "https://onequery.dev"',
    '  license "Apache-2.0"',
    `  version "${version}"`,
    "",
    ...indent(
      buildPlatformBlocks({
        platformReleases: includedPlatformReleases,
        releaseTag,
        repoName,
        repoOwner,
      }),
      1
    ),
    "",
    "  def install",
    "    # COMMENT: Homebrew unpacks npm-style tarballs under the staged build",
    "    # root, so package/vendor from the archive becomes vendor/ here.",
    '    libexec.install "vendor"',
    "",
    "    target_triple = if OS.mac?",
    '      Hardware::CPU.arm? ? "aarch64-apple-darwin" : "x86_64-apple-darwin"',
    "    elsif Hardware::CPU.arm?",
    '      "aarch64-unknown-linux-musl"',
    "    else",
    '      "x86_64-unknown-linux-musl"',
    "    end",
    "",
    '    cli_binary = libexec/"vendor/#{target_triple}/onequery/onequery"',
    "",
    "    # COMMENT: GitHub Actions artifact downloads normalize uploaded",
    "    # CLI binaries to 0644, so Homebrew installs must restore the",
    "    # executable bit before the wrapper launches them.",
    "    chmod 0755, cli_binary",
    "",
    '    (bin/"onequery").write_env_script(',
    "      cli_binary,",
    '      ONEQUERY_RUNTIME_ROOT: libexec/"vendor/#{target_triple}"',
    "    )",
    "  end",
    "",
    "  test do",
    '    assert_match "Usage: onequery config", shell_output("#{bin}/onequery config 2>&1")',
    "  end",
    "end",
    "",
  ];

  return formulaLines.join("\n");
}

export async function writeFormula({ outputPath, formulaText }) {
  if (!outputPath) {
    process.stdout.write(formulaText);
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, formulaText, "utf8");
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  const args = parseArgs(process.argv.slice(2));
  const formulaText = buildFormula(args);
  await writeFormula({
    formulaText,
    outputPath: args.outputPath,
  });
}
