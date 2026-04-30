import {
  createSelfHostLaunchConfig,
  createSelfHostRuntimePaths,
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
        runtimePaths: createSelfHostRuntimePaths({
          backupsDir: "/tmp/runtime/data/backups",
          dataDir: "/tmp/runtime/data",
          lifecycleEventLogPath: "/tmp/runtime/run/lifecycle.events.pb",
          logsDir: "/tmp/runtime/logs",
          runDir: "/tmp/runtime/run",
          runtimeLeasePath: "/tmp/runtime/run/runtime.lease.json",
          runtimeStatusSnapshotPath: "/tmp/runtime/run/runtime.status.json",
        }),
        smtp: createSelfHostSmtpConfig({
          fromName: "OneQuery",
          password: "smtp-password",
          secure: true,
          username: "smtp-user",
        }),
        storageDir: "/tmp/runtime/data/pglite/onequery",
      })
    );

    expect({
      emailDelivery: runtime.auth.emailDelivery,
      storage: runtime.storage,
    }).toMatchSnapshot();
  });
});
