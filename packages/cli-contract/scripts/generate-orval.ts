import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generate } from "orval";

const packageDir = fileURLToPath(new URL("..", import.meta.url));

// Comment: Orval's pinned Hono generator uses iterator helper methods such as
// `.toArray()`. Running the CLI binary directly goes through the system Node
// runtime in CI, which can lag Bun's iterator-helper support and fail during
// generation. Keep generation inside Bun by calling Orval programmatically.
await generate(resolve(packageDir, "orval.config.ts"), packageDir);
