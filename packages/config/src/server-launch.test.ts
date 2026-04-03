import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateServerLaunchConfig } from "./server-launch";
import {
  SAMPLE_MASTER_ENCRYPTION_KEY,
  createSelfHostLaunchConfig,
  createSelfHostRuntimePaths,
  createSelfHostSmtpConfig,
  createWorkspaceDevLaunchConfig,
} from "./testing";

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures"
);

describe("server launch contract", () => {
  it("accepts the shared self-host launch fixture", () => {
    const fixturePath = resolve(fixtureDir, "self-host-launch.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

    expect(
      validateServerLaunchConfig(fixture, `fixture ${fixturePath}`)
    ).toEqual(fixture);
  });

  it("rejects unknown keys", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createWorkspaceDevLaunchConfig(),
          unexpected: true,
        },
        "test"
      )
    ).toThrow("unexpected");
  });

  it("rejects missing required keys", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createWorkspaceDevLaunchConfig(),
          auth: undefined,
        },
        "test"
      )
    ).toThrow("auth");
  });

  it("rejects wrong scalar types", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createWorkspaceDevLaunchConfig(),
          listen: {
            host: "127.0.0.1",
            port: "4555",
          },
        },
        "test"
      )
    ).toThrow("listen.port");
  });

  it("rejects invalid storage union members", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createWorkspaceDevLaunchConfig(),
          storage: {
            kind: "sqlite",
            path: "/tmp/onequery.sqlite",
          },
        },
        "test"
      )
    ).toThrow("storage.kind");
  });

  it("requires runtimePaths for persistent rate limiting", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createWorkspaceDevLaunchConfig(),
          rateLimit: {
            enabled: true,
            storage: "persistent",
          },
        },
        "test"
      )
    ).toThrow("runtimePaths");
  });

  it("requires runtimePaths for self-host launch config", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createSelfHostLaunchConfig({
            runtimePaths: createSelfHostRuntimePaths(),
            smtp: createSelfHostSmtpConfig({
              password: "smtp-pass",
            }),
          }),
          rateLimit: {
            enabled: false,
            storage: "memory",
          },
          runtimePaths: undefined,
        },
        "test"
      )
    ).toThrow("runtimePaths");
  });

  it("rejects master keys that do not decode to exactly 32 bytes", () => {
    expect(() =>
      validateServerLaunchConfig(
        {
          ...createSelfHostLaunchConfig(),
          crypto: {
            masterEncryptionKey: "master",
          },
        },
        "test"
      )
    ).toThrow("crypto.masterEncryptionKey");
  });
});
