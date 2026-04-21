#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "rolldown";

import { serverBundleFilenameForTargetTriple } from "../bin/package-constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const CLI_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(CLI_ROOT, "..", "..");
// Comment: resolve the packaged server entry through the runtime package's
// declared export surface so CLI packaging does not depend on package-private
// source layout.
const SERVER_BUNDLE_ENTRYPOINT =
  require.resolve("@onequery/self-host-runtime/packaged-entry");
const WORKSPACE_SOURCE_CONDITION_NAMES = ["bun", "node", "import", "default"];
const BUILD_SERVER_BUNDLE_OPTIONS = new Set([
  "--help",
  "-h",
  "--outdir",
  "--target-triple",
]);
const EXTERNAL_SPECIFIERS = new Set([
  ...builtinModules,
  ...builtinModules.map((specifier) => `node:${specifier}`),
  "@casual-simulation/sql-parser/pkg/sql_parser_wasm_bg.wasm",
]);

export function defaultOutdirForTarget(targetTriple) {
  return path.join(CLI_ROOT, "dist", "vendor", targetTriple, "server");
}

export async function buildServerBundle({ outdir, targetTriple }) {
  if (!targetTriple) {
    throw new Error("Missing targetTriple.");
  }

  const resolvedOutdir = path.resolve(
    outdir ?? defaultOutdirForTarget(targetTriple)
  );
  await mkdir(resolvedOutdir, { recursive: true });

  const resolvedOutfile = path.join(
    resolvedOutdir,
    serverBundleFilenameForTargetTriple(targetTriple)
  );

  try {
    await build({
      cwd: WORKSPACE_ROOT,
      external(source) {
        return EXTERNAL_SPECIFIERS.has(source);
      },
      input: SERVER_BUNDLE_ENTRYPOINT,
      platform: "node",
      resolve: {
        // Comment: release bundling runs from a clean checkout, so prefer Bun's
        // workspace source exports instead of dist-only package defaults that
        // may not exist yet for sibling packages like @onequery/installer.
        conditionNames: WORKSPACE_SOURCE_CONDITION_NAMES,
      },
      transform: {
        target: "node22",
      },
      output: {
        codeSplitting: false,
        file: resolvedOutfile,
        format: "esm",
      },
    });
  } catch (error) {
    throw new Error(renderBuildFailure({ error, targetTriple }), {
      cause: error,
    });
  }

  return [resolvedOutfile];
}

function renderBuildFailure({ error, targetTriple }) {
  const detail =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : String(error);

  return `failed to bundle self-host server runtime for ${targetTriple}\n${detail}`;
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (value === undefined || BUILD_SERVER_BUNDLE_OPTIONS.has(value)) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

export function parseArgs(argv) {
  const args = {
    outdir: null,
    targetTriple: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--outdir": {
        args.outdir = readOptionValue(argv, index, argument);
        index += 1;
        break;
      }
      case "--target-triple": {
        args.targetTriple = readOptionValue(argv, index, argument);
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

  if (!args.targetTriple) {
    throw new Error("--target-triple is required.");
  }

  return args;
}

function printHelp() {
  console.log(`Usage: bun apps/cli/scripts/build-server-bundle.js --target-triple <target> [options]

Options:
  --outdir <path>      Output directory for the packaged server bundle
`);
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const outfiles = await buildServerBundle(args);
  console.log(outfiles.join("\n"));
}
