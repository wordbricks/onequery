import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSelfHostLaunchConfig,
  createWorkspaceDevLaunchConfig,
} from "@onequery/config/testing";
import { describe, expect, it } from "vitest";

import { loadLaunchConfigFile } from "./launch-config";

function createTempSpaBuildDir(): string {
  const assetDir = mkdtempSync(join(tmpdir(), "onequery-self-host-spa-test-"));
  writeFileSync(
    join(assetDir, "index.html"),
    "<!doctype html><title>spa</title>"
  );
  return assetDir;
}

describe("launch config", () => {
  it("loads and validates a serialized workspace-dev launch config file", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const assetDir = createTempSpaBuildDir();
    const launchConfigPath = join(root, "launch.json");
    const launchConfig = createWorkspaceDevLaunchConfig({
      assetsDistDir: assetDir,
    });

    writeFileSync(launchConfigPath, JSON.stringify(launchConfig, null, 2));

    expect(loadLaunchConfigFile(launchConfigPath)).toEqual(launchConfig);
  });

  it("loads and validates a serialized self-host launch config file", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const assetDir = createTempSpaBuildDir();
    const launchConfigPath = join(root, "launch.json");
    const launchConfig = createSelfHostLaunchConfig({
      assetsDistDir: assetDir,
    });

    writeFileSync(launchConfigPath, JSON.stringify(launchConfig, null, 2));

    expect(loadLaunchConfigFile(launchConfigPath)).toEqual(launchConfig);
  });

  it("wraps missing file errors", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));

    expect(() => loadLaunchConfigFile(join(root, "missing.json"))).toThrow(
      "Failed to read launch config file"
    );
  });

  it("wraps invalid JSON syntax", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(launchConfigPath, "{");

    expect(() => loadLaunchConfigFile(launchConfigPath)).toThrow(
      "Invalid launch config JSON"
    );
  });

  it("surfaces validator errors from the contract owner", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-launch-config-"));
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(
      launchConfigPath,
      JSON.stringify({
        ...createSelfHostLaunchConfig({
          assetsDistDir: createTempSpaBuildDir(),
        }),
        runtimePaths: undefined,
      })
    );

    expect(() => loadLaunchConfigFile(launchConfigPath)).toThrow(
      "runtimePaths"
    );
  });
});
