import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readTomlFileSync } from "./index";

function createTempRootDir(): string {
  return mkdtempSync(join(tmpdir(), "onequery-config-loader-"));
}

describe("@onequery/config-loader", () => {
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
