import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "orval";

const packageDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  cli: {
    input: {
      target: resolve(packageDir, "openapi/generated/cli.openapi.json"),
    },
    output: {
      client: "hono",
      mode: "split",
      override: {
        zod: {
          coerce: {
            // Comment: Hono query parameters arrive as strings, so Orval
            // must coerce numeric query fields like `limit` for runtime validation.
            query: ["number"],
          },
        },
        hono: {
          handlers: resolve(packageDir, "../cli-server/src/transport/handlers"),
          validatorOutputPath: resolve(
            packageDir,
            "../cli-server/generated/cli.validator.ts"
          ),
        },
      },
      target: resolve(packageDir, "../cli-server/generated/cli.ts"),
    },
  },
});
