import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const distDir = resolve(packageDir, "dist");
const packageJsonPath = resolve(packageDir, "package.json");
const runtimeConditions = ["bun", "default"];

function readPackageJson() {
  return JSON.parse(readFileSync(packageJsonPath, "utf8"));
}

export function getRuntimeTargets() {
  const packageJson = readPackageJson();
  const targets = new Set();

  for (const [subpath, conditionMap] of Object.entries(packageJson.exports)) {
    const runtimeTargets = runtimeConditions
      .map((condition) => conditionMap[condition])
      .filter((target) => typeof target === "string");

    if (runtimeTargets.length === 0) {
      throw new Error(`Missing runtime export target for ${subpath}.`);
    }

    for (const target of runtimeTargets) {
      targets.add(target);
    }
  }

  return [...targets].sort();
}

export function toDistRelativePath(runtimeTarget) {
  if (!runtimeTarget.startsWith("./src/") || !runtimeTarget.endsWith(".ts")) {
    throw new Error(`Unsupported runtime export target: ${runtimeTarget}`);
  }

  return runtimeTarget.replace("./src/", "").replace(/\.ts$/, ".js");
}

export async function buildConfigDist(outdir = distDir) {
  rmSync(outdir, {
    force: true,
    recursive: true,
  });

  const bunExecutable = Bun.which("bun") ?? "bun";
  const runtimeTargets = getRuntimeTargets();
  const entrypoints = runtimeTargets.map((target) => resolve(packageDir, target));
  const child = Bun.spawn(
    [
      bunExecutable,
      "build",
      ...entrypoints,
      "--outdir",
      outdir,
      "--target",
      "node",
      "--format",
      "esm",
      "--packages",
      "external",
      "--root",
      resolve(packageDir, "src"),
      "--entry-naming",
      "[dir]/[name].js",
    ],
    {
      cwd: packageDir,
      stderr: "inherit",
      stdout: "inherit",
    }
  );

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Config dist build failed with exit code ${exitCode}.`);
  }

  return {
    outdir,
    outputs: runtimeTargets.map(toDistRelativePath),
  };
}

if (import.meta.main) {
  await buildConfigDist();
}
