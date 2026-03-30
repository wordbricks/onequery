import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  syncManagedLocalConfigFile,
  writeManagedLocalConfigTemplate,
} from "@onequery/dev-config/local-env";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function main(): void {
  const configTemplateUpdated = writeManagedLocalConfigTemplate(rootDir);
  const localConfigResult = syncManagedLocalConfigFile(rootDir);

  if (configTemplateUpdated) {
    console.log(
      "Updated onequery.local.env.toml.template from the managed config contract."
    );
  } else {
    console.log(
      "onequery.local.env.toml.template already matches the managed config contract."
    );
  }

  if (localConfigResult.created) {
    console.log(
      `Created ${localConfigResult.path} from the managed config contract.`
    );
  } else if (localConfigResult.addedKeys.length > 0) {
    console.log(
      `Added ${localConfigResult.addedKeys.length} managed key(s) to ${localConfigResult.path}: ${localConfigResult.addedKeys.join(", ")}`
    );
  } else {
    console.log(`${localConfigResult.path} already includes all managed keys.`);
  }

  if (localConfigResult.errors.length > 0) {
    console.error(
      `Managed config validation failed for ${localConfigResult.path}:`
    );
    for (const error of localConfigResult.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
}

main();
