#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serverBuildsForTargetTriple } from "../bin/package-constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(CLI_ROOT, "..", "..");
const BUN_SERVER_ENTRYPOINT = path.join(
  WORKSPACE_ROOT,
  "packages",
  "bun-server",
  "src",
  "index.ts"
);
const BUILD_SERVER_EXECUTABLE_OPTIONS = new Set([
  "--help",
  "-h",
  "--outdir",
  "--target-triple",
]);

export function defaultOutdirForTarget(targetTriple) {
  return path.join(CLI_ROOT, "dist", "vendor", targetTriple, "server");
}

export async function buildServerExecutables({ outdir, targetTriple }) {
  if (!targetTriple) {
    throw new Error("Missing targetTriple.");
  }

  const resolvedOutdir = path.resolve(
    outdir ?? defaultOutdirForTarget(targetTriple)
  );
  await mkdir(resolvedOutdir, { recursive: true });

  const buildPlans = serverBuildsForTargetTriple(targetTriple);
  const outfiles = [];
  for (const buildPlan of buildPlans) {
    const resolvedOutfile = path.join(resolvedOutdir, buildPlan.filename);
    const result = await Bun.build({
      entrypoints: [BUN_SERVER_ENTRYPOINT],
      compile: {
        outfile: resolvedOutfile,
        target: buildPlan.compileTarget,
      },
    });

    if (!result.success) {
      throw new Error(
        renderBuildFailure({
          compileTarget: buildPlan.compileTarget,
          logs: result.logs,
          targetTriple,
        })
      );
    }

    if (result.logs.length > 0) {
      const errorLogs = result.logs.filter((log) => log.level === "error");
      if (errorLogs.length > 0) {
        throw new Error(
          renderBuildFailure({
            compileTarget: buildPlan.compileTarget,
            logs: errorLogs,
            targetTriple,
          })
        );
      }
    }

    outfiles.push(resolvedOutfile);
  }

  return outfiles;
}

function renderBuildFailure({ compileTarget, logs, targetTriple }) {
  const messages = logs
    .map((log) => log.message?.trim())
    .filter((message) => typeof message === "string" && message.length > 0);

  if (messages.length === 0) {
    return `failed to compile self-host server executable for ${targetTriple} (${compileTarget})`;
  }

  return `failed to compile self-host server executable for ${targetTriple} (${compileTarget})\n${messages.join("\n")}`;
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (value === undefined || BUILD_SERVER_EXECUTABLE_OPTIONS.has(value)) {
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
  console.log(`Usage: bun apps/cli/scripts/build-server-executable.js --target-triple <target> [options]

Options:
  --outdir <path>      Output directory for packaged server executables
`);
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const outfiles = await buildServerExecutables(args);
  console.log(outfiles.join("\n"));
}
