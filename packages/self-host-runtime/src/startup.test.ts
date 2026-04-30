import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  encodeServerLaunchConfigJson,
  viewServerLaunchConfig,
} from "@onequery/config/server-launch";
import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import {
  createSelfHostLaunchConfig,
  createWorkspaceDevLaunchConfig,
} from "@onequery/config/testing";
import { describe, expect, it } from "vitest";

import {
  loadStartupLaunchConfig,
  resolveStartupInputFromArgv,
} from "./startup";

function writeLaunchConfig(
  launchConfigPath: string,
  value: ServerLaunchConfig
): void {
  writeFileSync(launchConfigPath, encodeServerLaunchConfigJson(value));
}

describe("packaged server startup", () => {
  it("accepts an in-memory launch config object", () => {
    const launchConfig = createWorkspaceDevLaunchConfig({
      assetsDistDir: "/tmp/web",
      migrationsDir: "/tmp/migrations",
    });

    expect(loadStartupLaunchConfig({ launchConfig })).toEqual(launchConfig);
  });

  it("loads a launch config from the explicit startup argv path", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-self-host-startup-"));
    const launchConfigPath = join(root, "launch.json");

    const launchConfig = createWorkspaceDevLaunchConfig({
      assetsDistDir: "/tmp/web",
      migrationsDir: "/tmp/migrations",
    });
    writeLaunchConfig(launchConfigPath, launchConfig);

    const startupInput = resolveStartupInputFromArgv([
      "node",
      "src/node-entry.ts",
      launchConfigPath,
    ]);

    expect(loadStartupLaunchConfig(startupInput)).toEqual(launchConfig);
  });

  it("does not read repo-local workspace-dev files during self-host startup", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-self-host-startup-"));
    const launchConfigPath = join(root, "launch.json");

    // Comment: keep this in self-host mode. A workspace-dev launch config here
    // would make the acceptance check look stronger than it really is.
    writeFileSync(join(root, "onequery.dev.toml"), 'port = "not json"\n');
    writeFileSync(
      join(root, "onequery.dev.secrets.toml"),
      'secret = "not toml"\n'
    );
    writeLaunchConfig(
      launchConfigPath,
      createSelfHostLaunchConfig({
        assetsDistDir: "/tmp/web",
        migrationsDir: "/tmp/migrations",
      })
    );

    const loaded = loadStartupLaunchConfig({ launchConfigPath });
    expect(viewServerLaunchConfig(loaded, "test")).toMatchObject({
      common: {
        publicOrigin: "http://127.0.0.1:5656",
      },
      mode: "self-host",
      runtimePaths: {
        dataDir: "/tmp/onequery/data",
      },
    });
  });

  it("fails fast when no launch config path is provided", () => {
    expect(() =>
      resolveStartupInputFromArgv(["node", "src/node-entry.ts"])
    ).toThrow("Missing launch config path");
  });
});
