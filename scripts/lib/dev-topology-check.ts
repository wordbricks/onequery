import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderManagedLocalConfigFile } from "@onequery/dev-config/local-env";
import { LOCAL_TOPOLOGY } from "@onequery/dev-config/topology";

function pushIfMissing(
  mismatches: string[],
  input: {
    expectedSnippet: string;
    filePath: string;
    label: string;
  }
): void {
  const contents = readFileSync(input.filePath, "utf8");
  if (contents.includes(input.expectedSnippet)) {
    return;
  }

  mismatches.push(
    `${input.label} mismatch: expected to find ${JSON.stringify(input.expectedSnippet)}`
  );
}

function getDevTopologyMismatches(rootDir: string = process.cwd()): string[] {
  const mismatches: string[] = [];
  const bundledOrigin = LOCAL_TOPOLOGY.web.bundled.origin;
  const bundledLoopbackOrigin = LOCAL_TOPOLOGY.web.bundled.loopbackOrigin;
  const connectorApiBaseUrl = `${bundledOrigin}/api`;

  const localConfigTemplate = readFileSync(
    join(rootDir, "onequery.local.env.toml.template"),
    "utf8"
  );
  const expectedLocalConfigTemplate = renderManagedLocalConfigFile();
  if (localConfigTemplate !== expectedLocalConfigTemplate) {
    mismatches.push(
      "onequery.local.env.toml.template does not match the managed config contract; run `bun run env:sync`"
    );
  }

  const dockerCompose = readFileSync(
    join(rootDir, "docker-compose.yml"),
    "utf8"
  );
  const portBindingMatch = dockerCompose.match(
    /postgres:\s[\s\S]*?ports:\s[\s\S]*?-\s*"(?<host>\d+):(?<container>\d+)"/
  );
  if (!portBindingMatch?.groups) {
    mismatches.push(
      "docker-compose.yml postgres port binding is missing or unreadable"
    );
  } else {
    const { container, host } = portBindingMatch.groups;
    if (
      Number(host) !== LOCAL_TOPOLOGY.postgres.hostPort ||
      Number(container) !== LOCAL_TOPOLOGY.postgres.containerPort
    ) {
      mismatches.push(
        `docker-compose.yml postgres port binding mismatch: expected ${LOCAL_TOPOLOGY.postgres.portBinding}, found ${host}:${container}`
      );
    }
  }

  const cliConfig = readFileSync(
    join(rootDir, "apps/cli/crates/onequery-cli/src/config.rs"),
    "utf8"
  );
  const expectedConfigSetServerExample = `onequery config set server ${bundledLoopbackOrigin}`;
  if (
    !cliConfig.includes(
      `pub(crate) const DEFAULT_SELF_HOST_BASE_URL: &str = "${bundledOrigin}";`
    )
  ) {
    mismatches.push(
      `apps/cli/crates/onequery-cli/src/config.rs DEFAULT_SELF_HOST_BASE_URL mismatch: expected ${bundledOrigin}`
    );
  }
  if (
    !cliConfig.includes(
      "pub(crate) const DEFAULT_BASE_URL: &str = DEFAULT_SELF_HOST_BASE_URL;"
    )
  ) {
    mismatches.push(
      "apps/cli/crates/onequery-cli/src/config.rs DEFAULT_BASE_URL should alias DEFAULT_SELF_HOST_BASE_URL"
    );
  }
  if (
    !cliConfig.includes(
      `pub(crate) const CONFIG_SET_SERVER_COMMAND_EXAMPLE: &str =\n    "${expectedConfigSetServerExample}";`
    )
  ) {
    mismatches.push(
      `apps/cli/crates/onequery-cli/src/config.rs CONFIG_SET_SERVER_COMMAND_EXAMPLE mismatch: expected ${expectedConfigSetServerExample}`
    );
  }

  const cliSelfHostConfig = readFileSync(
    join(rootDir, "apps/cli/crates/onequery-cli/src/config/self_host.rs"),
    "utf8"
  );
  if (
    !cliSelfHostConfig.includes(
      "fn default_port() -> u16 {\n    DEFAULT_SELF_HOST_PORT\n}"
    )
  ) {
    mismatches.push(
      "apps/cli/crates/onequery-cli/src/config/self_host.rs default_port should return DEFAULT_SELF_HOST_PORT"
    );
  }
  if (
    !cliSelfHostConfig.includes(
      "fn default_listen_host() -> String {\n    DEFAULT_SELF_HOST_LISTEN_HOST.to_owned()\n}"
    )
  ) {
    mismatches.push(
      "apps/cli/crates/onequery-cli/src/config/self_host.rs default_listen_host should return DEFAULT_SELF_HOST_LISTEN_HOST"
    );
  }

  pushIfMissing(mismatches, {
    expectedSnippet: `const LANDING_LOCAL_SERVER_PORT = ${LOCAL_TOPOLOGY.web.bundled.port} as const;`,
    filePath: join(rootDir, "apps/landing/src/landing-config.ts"),
    label: "apps/landing/src/landing-config.ts LANDING_LOCAL_SERVER_PORT",
  });

  pushIfMissing(mismatches, {
    expectedSnippet: `http://127.0.0.1:\${LANDING_LOCAL_SERVER_PORT}`,
    filePath: join(rootDir, "apps/landing/src/landing-config.ts"),
    label: "apps/landing/src/landing-config.ts LANDING_LOCAL_SERVER_URL",
  });

  pushIfMissing(mismatches, {
    expectedSnippet: `ONEQUERY_BASE_URL = "${connectorApiBaseUrl}"`,
    filePath: join(rootDir, "apps/connector/README.md"),
    label: "apps/connector/README.md ONEQUERY_BASE_URL",
  });

  pushIfMissing(mismatches, {
    expectedSnippet: `ONEQUERY_BASE_URL = "${connectorApiBaseUrl}"`,
    filePath: join(rootDir, "apps/connector/config/local.toml.example"),
    label: "apps/connector/config/local.toml.example ONEQUERY_BASE_URL",
  });

  pushIfMissing(mismatches, {
    expectedSnippet: `Then open \`${bundledLoopbackOrigin}\` and complete the first-user bootstrap.`,
    filePath: join(rootDir, "docs/self-host.md"),
    label: "docs/self-host.md bootstrap URL",
  });

  pushIfMissing(mismatches, {
    expectedSnippet: expectedConfigSetServerExample,
    filePath: join(rootDir, "docs/self-host.md"),
    label: "docs/self-host.md config set example",
  });

  pushIfMissing(mismatches, {
    expectedSnippet: `port = ${LOCAL_TOPOLOGY.web.bundled.port}`,
    filePath: join(rootDir, "docs/self-host.md"),
    label: "docs/self-host.md self-host port",
  });

  return mismatches;
}

export function assertDevTopologyArtifactsInSync(
  rootDir: string = process.cwd()
): void {
  const mismatches = getDevTopologyMismatches(rootDir);
  if (mismatches.length === 0) {
    return;
  }

  throw new Error(
    [
      "Local topology drift detected.",
      ...mismatches.map((mismatch) => `- ${mismatch}`),
      'Update the SSoT in "@onequery/dev-config" and keep these tracked artifacts aligned.',
    ].join("\n")
  );
}
