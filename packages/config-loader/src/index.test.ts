import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  literalConfigAdapter,
  loadConfigFromSourcesSync,
  readTomlFileSync,
} from "./index";

function createTempRootDir(): string {
  return mkdtempSync(join(tmpdir(), "onequery-config-loader-"));
}

describe("@onequery/config-loader", () => {
  it("loads config with literal defaults, TOML values, then env overrides", () => {
    const rootDir = createTempRootDir();
    const configPath = join(rootDir, "config.toml");

    try {
      writeFileSync(
        configPath,
        ["PORT = 4545", 'HOST = "toml-host"', "FEATURE_ENABLED = true"].join(
          "\n"
        ),
        "utf8"
      );

      const config = loadConfigFromSourcesSync({
        adapters: [
          literalConfigAdapter({
            data: {
              FEATURE_ENABLED: false,
              HOST: "default-host",
              PORT: 3000,
            },
            name: "defaults",
          }),
        ],
        env: {
          HOST: "env-host",
        },
        schema: z.object({
          FEATURE_ENABLED: z.boolean(),
          HOST: z.string(),
          PORT: z.number().int().positive(),
        }),
        tomlPath: configPath,
      });

      expect(config).toEqual({
        FEATURE_ENABLED: true,
        HOST: "env-host",
        PORT: 4545,
      });
      expect(Object.isFrozen(config)).toBe(true);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("reads TOML objects directly for bookkeeping callers", () => {
    const rootDir = createTempRootDir();
    const configPath = join(rootDir, "config.toml");

    try {
      writeFileSync(
        configPath,
        ['host = "localhost"', "[nested]", "port = 4545"].join("\n"),
        "utf8"
      );

      expect(readTomlFileSync(configPath)).toEqual({
        host: "localhost",
        nested: {
          port: 4545,
        },
      });
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("reports TOML parse failures with the file path", () => {
    const rootDir = createTempRootDir();
    const configPath = join(rootDir, "broken.toml");

    try {
      writeFileSync(configPath, 'host = "localhost', "utf8");

      expect(() => readTomlFileSync(configPath)).toThrow(
        `Failed to parse / read TOML file at ${configPath}:`
      );
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
