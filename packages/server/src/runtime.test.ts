import {
  createSelfHostLaunchConfig,
  createSelfHostSmtpConfig,
  createWorkspaceDevLaunchConfig,
} from "@onequery/config/testing";
import { describe, expect, it } from "vitest";

import { createServerRuntimeConfig } from "./runtime";

describe("createServerRuntimeConfig", () => {
  it("maps a postgres launch contract into a typed runtime config", () => {
    const runtime = createServerRuntimeConfig(
      createWorkspaceDevLaunchConfig({
        assetsDistDir: "/tmp/web",
        authSecret: "auth-secret",
        migrationsDir: "/tmp/migrations",
      })
    );

    expect(runtime).toMatchSnapshot();
  });

  it("maps smtp and pglite launch settings without falling back to env defaults", () => {
    const runtime = createServerRuntimeConfig(
      createSelfHostLaunchConfig({
        assetsDistDir: "/tmp/web",
        authSecret: "auth-secret",
        migrationsDir: "/tmp/migrations",
        publicOrigin: "https://onequery.example.com",
        runtimePaths: {
          backupsDir: "/tmp/runtime/backups",
          dataDir: "/tmp/runtime/data",
          lockPath: "/tmp/runtime/run/server.lock",
          logsDir: "/tmp/runtime/logs",
          pidPath: "/tmp/runtime/run/server.pid",
          runDir: "/tmp/runtime/run",
        },
        smtp: createSelfHostSmtpConfig({
          fromName: "OneQuery",
          password: "smtp-password",
          secure: true,
          username: "smtp-user",
        }),
        storageDir: "/tmp/runtime/pglite/onequery",
      })
    );

    expect({
      emailDelivery: runtime.auth.emailDelivery,
      storage: runtime.storage,
    }).toMatchSnapshot();
  });
});
