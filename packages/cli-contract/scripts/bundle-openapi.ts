import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import SwaggerParser from "@apidevtools/swagger-parser";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = resolve(packageDir, "openapi/source/cli.openapi.yaml");
const outputPath = resolve(packageDir, "openapi/generated/cli.openapi.json");

const bundledDocument = await SwaggerParser.bundle(sourcePath);

// Comment: Rust and HTTP discovery still consume the bundled JSON artifact at
// `openapi/generated/cli.openapi.json` directly, so regeneration must keep it
// in sync with the split YAML source tree.
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(bundledDocument, null, "\t")}\n`);
