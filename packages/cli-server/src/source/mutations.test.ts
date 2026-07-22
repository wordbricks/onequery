import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteCliSource, updateCliSource } from "./mutations";

describe("CLI source mutations", () => {
  const loadSource = vi.fn();
  const decryptCredentials = vi.fn();
  const encryptCredentials = vi.fn();
  const testCredentials = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    loadSource.mockResolvedValue({
      kind: "found",
      source: {
        credentialsEncrypted: "encrypted-current",
        credentialsIv: "iv-current",
        displayName: null,
        id: "source-1",
        name: "getgpt-sentry",
        organizationId: "org-1",
        provider: "sentry",
        sourceKey: "getgpt-sentry",
        status: "error",
      },
    });
    decryptCredentials.mockReturnValue(
      Result.ok({
        authToken: "secret-token",
        organizationSlug: "wrong-slug",
        projectSlug: "frontend",
        type: "sentry",
      })
    );
    encryptCredentials.mockReturnValue({
      ciphertext: "encrypted-updated",
      iv: "iv-updated",
    });
    testCredentials.mockResolvedValue({
      kind: "supported",
      result: {
        latencyMs: 21,
        message: "Connected to Sentry",
        success: true,
      },
    });
  });

  const updateDependencies = {
    decryptCredentials,
    encryptCredentials,
    loadSource,
    testCredentials,
  };

  const deleteDependencies = { loadSource };

  it("tests and persists a merged credential patch", async () => {
    let persisted: Record<string, unknown> | undefined;
    const db = {
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          persisted = values;
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [
                {
                  id: "source-1",
                  name: "getgpt-sentry",
                  provider: "sentry",
                  status: "active",
                },
              ]),
            })),
          };
        }),
      })),
    };

    const result = await updateCliSource(
      {
        credentialsPatch: { organizationSlug: "wordbricks" },
        db: db as never,
        masterEncryptionKey: new Uint8Array(32),
        organizationId: "org-1",
        sourceKey: "getgpt-sentry",
        sourceProvider: "sentry",
      },
      updateDependencies as never
    );

    expect(testCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          authToken: "secret-token",
          organizationSlug: "wordbricks",
        }),
        organizationId: "org-1",
      })
    );
    expect(persisted).toMatchObject({
      credentialsEncrypted: "encrypted-updated",
      credentialsIv: "iv-updated",
      errorMessage: null,
      status: "active",
    });
    expect(result).toMatchObject({
      kind: "updated",
      source: { sourceKey: "getgpt-sentry", provider: "sentry" },
      test: { latencyMs: 21, kind: "supported" },
    });
  });

  it("does not persist credentials when the connection test fails", async () => {
    const update = vi.fn();
    testCredentials.mockResolvedValueOnce({
      kind: "supported",
      result: {
        error: "Organization not found",
        latencyMs: 10,
        message: "Invalid organization slug",
        success: false,
      },
    });

    const result = await updateCliSource(
      {
        credentialsPatch: { organizationSlug: "still-wrong" },
        db: { update } as never,
        masterEncryptionKey: new Uint8Array(32),
        organizationId: "org-1",
        sourceKey: "getgpt-sentry",
        sourceProvider: "sentry",
      },
      updateDependencies as never
    );

    expect(result).toEqual({
      detail: "Organization not found",
      kind: "connection_test_failed",
      message: "Invalid organization slug",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects credential field typos instead of silently stripping them", async () => {
    const result = await updateCliSource(
      {
        credentialsPatch: { organisationSlug: "wordbricks" },
        db: {} as never,
        masterEncryptionKey: new Uint8Array(32),
        organizationId: "org-1",
        sourceKey: "getgpt-sentry",
        sourceProvider: "sentry",
      },
      updateDependencies as never
    );

    expect(result).toEqual({
      detail: "unsupported credential field: organisationSlug",
      kind: "invalid_credentials",
    });
    expect(testCredentials).not.toHaveBeenCalled();
  });

  it("deletes only the loaded source in the authorized org", async () => {
    const returning = vi.fn(async () => [{ id: "source-1" }]);
    const where = vi.fn(() => ({ returning }));
    const deleteRows = vi.fn(() => ({ where }));

    const result = await deleteCliSource(
      {
        db: { delete: deleteRows } as never,
        organizationId: "org-1",
        sourceKey: "getgpt-sentry",
        sourceProvider: "sentry",
      },
      deleteDependencies as never
    );

    expect(deleteRows).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      kind: "deleted",
      source: { sourceKey: "getgpt-sentry", provider: "sentry" },
    });
  });
});
