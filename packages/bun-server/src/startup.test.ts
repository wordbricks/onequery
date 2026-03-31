import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "../../dev-config/src/master-encryption-key";
import {
  loadStartupLaunchConfig,
  resolveStartupInputFromArgv,
} from "./startup";

describe("bun-server startup", () => {
  it("accepts an in-memory launch config object", () => {
    const launchConfig = {
      assets: {
        distDir: "/tmp/web",
      },
      auth: {
        secret: "workspace-auth-secret",
      },
      connectors: {
        enrollmentToken: "connector-token",
      },
      crypto: {
        masterEncryptionKey: SAMPLE_MASTER_ENCRYPTION_KEY,
      },
      listen: {
        host: "127.0.0.1",
        port: 4555,
      },
      mode: "workspace-dev" as const,
      publicOrigin: "http://localhost:4545",
      rateLimit: {
        enabled: false,
        storage: "memory" as const,
      },
      storage: {
        kind: "postgres" as const,
        url: "postgres://onequery:onequery@localhost:5454/onequery",
      },
    };

    expect(loadStartupLaunchConfig({ launchConfig })).toEqual(launchConfig);
  });

  it("loads a launch config from the explicit startup argv path", () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-bun-startup-"));
    const launchConfigPath = join(root, "launch.json");

    writeFileSync(
      launchConfigPath,
      JSON.stringify(
        {
          assets: {
            distDir: "/tmp/web",
          },
          auth: {
            secret: "workspace-auth-secret",
          },
          connectors: {
            enrollmentToken: "connector-token",
          },
          crypto: {
            masterEncryptionKey: SAMPLE_MASTER_ENCRYPTION_KEY,
          },
          listen: {
            host: "127.0.0.1",
            port: 4555,
          },
          mode: "workspace-dev",
          publicOrigin: "http://localhost:4545",
          rateLimit: {
            enabled: false,
            storage: "memory",
          },
          storage: {
            kind: "postgres",
            url: "postgres://onequery:onequery@localhost:5454/onequery",
          },
        },
        null,
        2
      )
    );

    const startupInput = resolveStartupInputFromArgv([
      "bun",
      "src/index.ts",
      launchConfigPath,
    ]);

    expect(loadStartupLaunchConfig(startupInput)).toEqual({
      assets: {
        distDir: "/tmp/web",
      },
      auth: {
        secret: "workspace-auth-secret",
      },
      connectors: {
        enrollmentToken: "connector-token",
      },
      crypto: {
        masterEncryptionKey: SAMPLE_MASTER_ENCRYPTION_KEY,
      },
      listen: {
        host: "127.0.0.1",
        port: 4555,
      },
      mode: "workspace-dev",
      publicOrigin: "http://localhost:4545",
      rateLimit: {
        enabled: false,
        storage: "memory",
      },
      storage: {
        kind: "postgres",
        url: "postgres://onequery:onequery@localhost:5454/onequery",
      },
    });
  });

  it("fails fast when no launch config path is provided", () => {
    expect(() => resolveStartupInputFromArgv(["bun", "src/index.ts"])).toThrow(
      "Missing launch config path"
    );
  });
});
