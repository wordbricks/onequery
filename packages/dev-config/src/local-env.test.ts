import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createLocalProcessEnv,
  readLocalConfigFile,
  renderManagedLocalConfigFile,
  syncManagedLocalConfigFile,
} from "./local-env";
import { LOCAL_TOPOLOGY } from "./topology";

const GENERATED_BETTER_AUTH_SECRET_PLACEHOLDER = "generated-by-config-sync";

function createTempRootDir(): string {
  return mkdtempSync(join(tmpdir(), "onequery-local-env-"));
}

function writeManagedLocalConfig(rootDir: string, contents: string): void {
  writeFileSync(join(rootDir, "onequery.local.env.toml"), contents, "utf8");
}

describe("local config sync", () => {
  it("keeps the tracked template deterministic while local config gets a random Better Auth secret", () => {
    expect(renderManagedLocalConfigFile()).toContain(
      `BETTER_AUTH_SECRET = "${GENERATED_BETTER_AUTH_SECRET_PLACEHOLDER}"`
    );

    const rootDir = createTempRootDir();

    try {
      const result = syncManagedLocalConfigFile(rootDir);
      const localConfig = readLocalConfigFile(rootDir);

      expect(result.created).toBe(true);
      expect(localConfig.BETTER_AUTH_SECRET).toEqual(expect.any(String));
      expect(localConfig.BETTER_AUTH_SECRET).not.toBe(
        GENERATED_BETTER_AUTH_SECRET_PLACEHOLDER
      );
      expect(
        (localConfig.BETTER_AUTH_SECRET as string).length
      ).toBeGreaterThanOrEqual(32);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("preserves the seeded Better Auth secret across repeated syncs", () => {
    const rootDir = createTempRootDir();

    try {
      syncManagedLocalConfigFile(rootDir);
      const firstSecret = readLocalConfigFile(rootDir).BETTER_AUTH_SECRET;

      const secondResult = syncManagedLocalConfigFile(rootDir);
      const secondSecret = readLocalConfigFile(rootDir).BETTER_AUTH_SECRET;

      expect(secondResult.created).toBe(false);
      expect(secondResult.addedKeys).toEqual([]);
      expect(secondSecret).toBe(firstSecret);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("backfills a missing Better Auth secret with a random value in the TOML source", () => {
    const rootDir = createTempRootDir();

    try {
      writeManagedLocalConfig(
        rootDir,
        [
          'DATABASE_URL = "postgres://onequery:onequery@127.0.0.1:5432/onequery_dev"',
          'BETTER_AUTH_URL = "http://127.0.0.1:3000"',
          'WEB_URL = "http://127.0.0.1:3000"',
          'CONNECTOR_ENROLLMENT_TOKEN = "connector-token"',
          'MASTER_ENCRYPTION_KEY = "sample-encryption-key"',
          "DISABLE_RATE_LIMIT = true",
        ].join("\n")
      );

      const configResult = syncManagedLocalConfigFile(rootDir);
      const localConfig = readLocalConfigFile(rootDir);

      expect(configResult.addedKeys).toEqual(["BETTER_AUTH_SECRET"]);
      expect(localConfig.BETTER_AUTH_SECRET).toEqual(expect.any(String));
      expect(localConfig.BETTER_AUTH_SECRET).not.toBe(
        GENERATED_BETTER_AUTH_SECRET_PLACEHOLDER
      );
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("projects TOML-managed values into process env without writing an env artifact", () => {
    const rootDir = createTempRootDir();

    try {
      writeManagedLocalConfig(
        rootDir,
        [
          'DATABASE_URL = "postgres://config:secret@127.0.0.1:5454/app"',
          `BETTER_AUTH_URL = "${LOCAL_TOPOLOGY.web.bundled.origin}"`,
          `WEB_URL = "${LOCAL_TOPOLOGY.web.bundled.origin}"`,
          'BETTER_AUTH_SECRET = "toml-secret"',
          'CONNECTOR_ENROLLMENT_TOKEN = "connector-token"',
          'MASTER_ENCRYPTION_KEY = "config-key"',
          "DISABLE_RATE_LIMIT = false",
        ].join("\n")
      );

      const env = createLocalProcessEnv(rootDir, {
        CONNECTOR_ENROLLMENT_TOKEN: "override-token",
      });

      expect(env.DATABASE_URL).toBe(
        "postgres://config:secret@127.0.0.1:5454/app"
      );
      expect(env.BETTER_AUTH_SECRET).toBe("toml-secret");
      expect(env.DISABLE_RATE_LIMIT).toBe("false");
      expect(env.CONNECTOR_ENROLLMENT_TOKEN).toBe("override-token");
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
