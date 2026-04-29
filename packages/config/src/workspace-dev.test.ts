import { describe, expect, it } from "vitest";

import { projectDockerComposeConfig } from "./projections/docker";
import { projectDrizzleConfig } from "./projections/drizzle";
import { projectWorkspaceDevServerLaunchConfig } from "./projections/server-launch";
import { projectViteDevServerConfig } from "./projections/vite";
import { encodeServerLaunchConfigJson } from "./server-launch";
import { deriveTestProfile } from "./test-profile";
import { SAMPLE_MASTER_ENCRYPTION_KEY } from "./testing";
import {
  formatWorkspaceDevIssuePath,
  parseWorkspaceDev,
} from "./workspace-dev";
import type { ParseWorkspaceDevResult } from "./workspace-dev";

function createValidWorkspaceDevInput(): {
  config: {
    api: {
      host: string;
      port: number;
    };
    browser: {
      host: string;
      port: number;
    };
    flags: {
      disable_rate_limit: boolean;
    };
    postgres: {
      container_port: number;
      database: string;
      host_port: number;
      password: string;
      user: string;
    };
  };
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
    config: {
      api: {
        host: "127.0.0.1",
        port: 4601,
      },
      browser: {
        host: "127.0.0.1",
        port: 4600,
      },
      flags: {
        disable_rate_limit: false,
      },
      postgres: {
        container_port: 5433,
        database: "workspace",
        host_port: 6500,
        password: "secret",
        user: "workspace",
      },
    },
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
    const workspaceDev = expectParseSuccess(
      parseWorkspaceDev(createValidWorkspaceDevInput())
    );

    expect(workspaceDev).toMatchObject({
      api: {
        listen: {
          host: "127.0.0.1",
          port: 4601,
        },
        origin: "http://127.0.0.1:4601",
      },
      browser: {
        origin: "http://127.0.0.1:4600",
      },
      flags: {
        disableRateLimit: false,
      },
      postgres: {
        host: "localhost",
        portBinding: "6500:5433",
        url: "postgres://workspace:secret@localhost:6500/workspace",
      },
      profile: "workspace-dev",
      publicOrigin: "http://127.0.0.1:4600",
    });

    expect({
      dockerCompose: projectDockerComposeConfig(workspaceDev),
      drizzle: projectDrizzleConfig(workspaceDev),
      serverLaunch: JSON.parse(
        encodeServerLaunchConfigJson(
          projectWorkspaceDevServerLaunchConfig(workspaceDev, {
            assetDir: "/tmp/workspace-web",
            migrationsDir: "/tmp/workspace-migrations",
          })
        )
      ),
      testProfile: deriveTestProfile(workspaceDev),
      vite: projectViteDevServerConfig(workspaceDev),
    }).toMatchSnapshot();
  });

  it("collects config and secrets issues without file-system context", () => {
    const issues = expectParseFailure(
      parseWorkspaceDev({
        config: {},
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
          path: "browser",
          source: "config",
        }),
        expect.objectContaining({
          path: "api",
          source: "config",
        }),
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

  it("rejects duplicate host ports as config errors", () => {
    const input = createValidWorkspaceDevInput();
    input.config.api.port = input.config.browser.port;

    const issues = expectParseFailure(parseWorkspaceDev(input));

    expect(issues).toContainEqual({
      message:
        'Workspace-dev host ports must be unique. "api.port" conflicts with "browser.port" on 4600.',
      path: ["api", "port"],
      source: "config",
    });
  });
});
