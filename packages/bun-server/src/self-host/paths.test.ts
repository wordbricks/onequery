import { describe, expect, it } from "vitest";

import { resolveSelfHostRuntimePaths } from "./paths";

describe("self-host runtime paths", () => {
  it("prefers explicit self-host config and data roots from env", () => {
    const paths = resolveSelfHostRuntimePaths({
      ONEQUERY_SELF_HOST_CONFIG_DIR: "/tmp/config-dir",
      ONEQUERY_SELF_HOST_DATA_DIR: "/tmp/data-dir",
    });

    expect(paths).toMatchObject({
      configDir: "/tmp/config-dir",
      dataDir: "/tmp/data-dir",
      configPath: "/tmp/config-dir/config.toml",
      secretsPath: "/tmp/config-dir/secrets.toml",
      sqlitePath: "/tmp/data-dir/sqlite/onequery.sqlite",
      serverLogPath: "/tmp/data-dir/logs/server.log",
      backupsDir: "/tmp/data-dir/backups",
      pidPath: "/tmp/data-dir/run/server.pid",
      lockPath: "/tmp/data-dir/run/server.lock",
    });
  });

  it("falls back to XDG-shaped unix roots when self-host env roots are absent", () => {
    const paths = resolveSelfHostRuntimePaths(
      {
        HOME: "/Users/alice",
      },
      {
        homedir: () => "/Users/alice",
        platform: () => "darwin",
      }
    );

    expect(paths).toMatchObject({
      configDir: "/Users/alice/.config/onequery/self-host",
      dataDir: "/Users/alice/.local/share/onequery",
    });
  });
});
