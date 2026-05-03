import { describe, expect, it } from "vitest";

import { projectDrizzleConfig } from "./projections/drizzle";
import { projectWorkspaceDevServerLaunchConfig } from "./projections/server-launch";
import { projectViteDevServerConfig } from "./projections/vite";
import { encodeServerLaunchConfigJson } from "./server-launch";
import { SAMPLE_MASTER_ENCRYPTION_KEY } from "./testing";
import {
  formatWorkspaceDevIssuePath,
  parseWorkspaceDev,
} from "./workspace-dev";
import type { ParseWorkspaceDevResult } from "./workspace-dev";

function createValidWorkspaceDevInput(): {
  secrets: {
    auth: {
      secret: string;
    };
    connectors: {
      enrollment_token: string;
    };
    crypto: {
      master_encryption_key: string;
    };
  };
} {
  return {
    secrets: {
      auth: {
        secret: "workspace-auth-secret",
      },
      connectors: {
        enrollment_token: "workspace-connector-token",
      },
      crypto: {
        master_encryption_key: SAMPLE_MASTER_ENCRYPTION_KEY,
      },
    },
  };
}

function expectParseSuccess(
  result: ParseWorkspaceDevResult
): NonNullable<ParseWorkspaceDevResult & { ok: true }>["value"] {
  if (!result.ok) {
    throw new Error(
      `Expected workspace-dev parse success, got issues: ${JSON.stringify(result.error.issues)}`
    );
  }

  return result.value;
}

function expectParseFailure(
  result: ParseWorkspaceDevResult
): NonNullable<ParseWorkspaceDevResult & { ok: false }>["error"]["issues"] {
  if (result.ok) {
    throw new Error("Expected workspace-dev parse failure.");
  }

  return result.error.issues;
}

describe("@onequery/config workspace-dev", () => {
  it("parses workspace-dev config and produces stable projections", () => {
    const storageDir = "/tmp/workspace-pglite";
    const workspaceDev = expectParseSuccess(
      parseWorkspaceDev(createValidWorkspaceDevInput())
    );

    expect(workspaceDev).toMatchObject({
      api: {
        listen: {
          host: "127.0.0.1",
          port: 4555,
        },
        origin: "http://127.0.0.1:4555",
      },
      browser: {
        origin: "http://localhost:4545",
      },
      flags: {
        disableRateLimit: true,
      },
      profile: "workspace-dev",
      publicOrigin: "http://localhost:4545",
    });

    expect({
      drizzle: projectDrizzleConfig(workspaceDev, {
        storageDir,
      }),
      serverLaunch: JSON.parse(
        encodeServerLaunchConfigJson(
          projectWorkspaceDevServerLaunchConfig(workspaceDev, {
            assetDir: "/tmp/workspace-web",
            migrationsDir: "/tmp/workspace-migrations",
            storageDir,
          })
        )
      ),
      vite: projectViteDevServerConfig(workspaceDev),
    }).toMatchSnapshot();
  });

  it("collects secrets issues without file-system context", () => {
    const issues = expectParseFailure(
      parseWorkspaceDev({
        secrets: {},
      })
    ).map((issue) => ({
      message: issue.message,
      path: formatWorkspaceDevIssuePath(issue.path),
      source: issue.source,
    }));

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "auth",
          source: "secrets",
        }),
        expect.objectContaining({
          path: "crypto",
          source: "secrets",
        }),
      ])
    );
  });

  it("rejects invalid master encryption keys as secrets errors", () => {
    const input = createValidWorkspaceDevInput();
    input.secrets.crypto.master_encryption_key = "master";

    const issues = expectParseFailure(parseWorkspaceDev(input));

    expect(issues).toContainEqual({
      message:
        "Master encryption key must be valid base64 that decodes to exactly 32 bytes.",
      path: ["crypto", "master_encryption_key"],
      source: "secrets",
    });
  });
});
