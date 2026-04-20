import { describe, expect, it } from "vitest";

import {
  TEST_PUBLIC_ORIGIN,
  TestRuntimeConfigError,
  createTestRuntimeConfig,
  createTestRuntimeConfigFromDatabaseUrl,
} from "./test-env";

describe("test-env runtime config helpers", () => {
  it("returns a decoded runtime config for the default test environment", () => {
    const runtimeConfig = createTestRuntimeConfig();

    expect(runtimeConfig.isOk()).toBe(true);
    if (runtimeConfig.isErr()) {
      return;
    }

    expect(runtimeConfig.value.publicOrigin).toBe(TEST_PUBLIC_ORIGIN);
    expect(runtimeConfig.value.crypto.masterEncryptionKey).toBeInstanceOf(
      Uint8Array
    );
    expect(runtimeConfig.value.storage).toMatchObject({
      kind: "postgres",
      url: "postgres://test:test@localhost:5454/test",
    });
  });

  it("uses the database URL override without leaking helper-only fields", () => {
    const runtimeConfig = createTestRuntimeConfigFromDatabaseUrl(
      "pglite:/tmp/test-runtime-db"
    );

    expect(runtimeConfig.isOk()).toBe(true);
    if (runtimeConfig.isErr()) {
      return;
    }

    expect(runtimeConfig.value.storage).toEqual({
      connectionString: "pglite:/tmp/test-runtime-db",
      dir: "/tmp/test-runtime-db",
      kind: "pglite",
    });
    expect("databaseUrl" in runtimeConfig.value).toBe(false);
  });

  it("returns a typed error for invalid test master-key overrides", () => {
    const runtimeConfig = createTestRuntimeConfig({
      crypto: {
        masterEncryptionKey: "master",
      },
    });

    expect(runtimeConfig.isErr()).toBe(true);
    if (runtimeConfig.isOk()) {
      return;
    }

    expect(runtimeConfig.error).toBeInstanceOf(TestRuntimeConfigError);
    expect(runtimeConfig.error).toMatchObject({
      _tag: "TestRuntimeConfigError",
      field: "crypto.masterEncryptionKey",
      message: expect.stringContaining(
        "Invalid test runtime crypto.masterEncryptionKey"
      ),
    });
  });
});
