import { existsSync, readFileSync, statSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  buildConfigDist,
  getRuntimeTargets,
  packageDir,
  toDistRelativePath,
} from "./build-dist.mjs";

const packageJsonPath = resolve(packageDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const runtimeConditions = ["bun", "default"];

function assertFileExists(relativePath) {
  const absolutePath = resolve(packageDir, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Export target does not exist: ${relativePath}`);
  }

  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Export target is not a file: ${relativePath}`);
  }

  if (stats.size === 0) {
    throw new Error(`Export target is empty: ${relativePath}`);
  }
}

for (const [subpath, conditionMap] of Object.entries(packageJson.exports)) {
  const runtimeTargets = runtimeConditions
    .map((condition) => conditionMap[condition])
    .filter((target) => typeof target === "string");

  if (runtimeTargets.length === 0) {
    throw new Error(`Missing runtime export target for ${subpath}.`);
  }

  if (new Set(runtimeTargets).size !== 1) {
    throw new Error(
      `${subpath} splits runtime targets across conditions: ${runtimeTargets.join(", ")}`
    );
  }

  for (const target of new Set([
    conditionMap.types,
    ...runtimeTargets,
  ])) {
    if (typeof target === "string") {
      assertFileExists(target);
    }
  }
}

const tempDistDir = join(
  tmpdir(),
  `onequery-config-dist-${process.pid}-${Date.now()}`
);

try {
  const { outputs } = await buildConfigDist(tempDistDir);

  for (const relativePath of outputs) {
    const absolutePath = resolve(tempDistDir, relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Generated dist artifact is missing: ${relativePath}`);
    }

    const stats = statSync(absolutePath);
    if (!stats.isFile() || stats.size === 0) {
      throw new Error(`Generated dist artifact is empty: ${relativePath}`);
    }
  }

  const expectedOutputs = new Set(getRuntimeTargets().map(toDistRelativePath));
  for (const relativePath of expectedOutputs) {
    if (!outputs.includes(relativePath)) {
      throw new Error(`Missing expected dist artifact: ${relativePath}`);
    }
  }
} finally {
  rmSync(tempDistDir, {
    force: true,
    recursive: true,
  });
}

console.log("Config package surface is consistent.");
