import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderManagedLocalConfigFile } from "@onequery/dev-config/local-env";
import {
  LOCAL_POSTGRES_CONTAINER_PORT,
  LOCAL_POSTGRES_HOST_PORT,
  LOCAL_WEB_ORIGIN,
} from "@onequery/dev-config/topology";

function getDevTopologyMismatches(rootDir: string = process.cwd()): string[] {
  const mismatches: string[] = [];

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
      Number(host) !== LOCAL_POSTGRES_HOST_PORT ||
      Number(container) !== LOCAL_POSTGRES_CONTAINER_PORT
    ) {
      mismatches.push(
        `docker-compose.yml postgres port binding mismatch: expected ${LOCAL_POSTGRES_HOST_PORT}:${LOCAL_POSTGRES_CONTAINER_PORT}, found ${host}:${container}`
      );
    }
  }

  const cliConfig = readFileSync(
    join(rootDir, "apps/cli/crates/onequery-cli/src/config.rs"),
    "utf8"
  );
  const debugBaseUrlMatch = cliConfig.match(
    /#\[cfg\(debug_assertions\)\]\s+pub\(crate\) const DEFAULT_BASE_URL: &str = "([^"]+)";/
  );
  if (!debugBaseUrlMatch) {
    mismatches.push(
      "apps/cli/crates/onequery-cli/src/config.rs debug DEFAULT_BASE_URL is missing"
    );
  } else if (debugBaseUrlMatch[1] !== LOCAL_WEB_ORIGIN) {
    mismatches.push(
      `apps/cli/crates/onequery-cli/src/config.rs DEFAULT_BASE_URL mismatch: expected ${LOCAL_WEB_ORIGIN}, found ${debugBaseUrlMatch[1]}`
    );
  }

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
