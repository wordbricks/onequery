import { readdirSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function readTextTree(url: URL): string {
  const root = fileURLToPath(url);
  const entries = readdirSync(root, { withFileTypes: true });

  return entries
    .flatMap((entry) => {
      const entryUrl = new URL(
        `${entry.name}${entry.isDirectory() ? "/" : ""}`,
        url
      );
      if (entry.isDirectory()) {
        return readTextTree(entryUrl);
      }
      if (extname(entry.name) !== ".ts" || entry.name.endsWith(".test.ts")) {
        return [];
      }
      return readFileSync(fileURLToPath(entryUrl), "utf8");
    })
    .join("\n");
}

describe("source api quality bar", () => {
  it("does not retain the legacy custom JSON AST in the source-api path", () => {
    const sourceApiText = readTextTree(new URL("./", import.meta.url));
    const connectServiceText = readTextTree(
      new URL("../../../cli-server/src/connect/service/", import.meta.url)
    );
    const combined = `${sourceApiText}\n${connectServiceText}`;

    expect(combined).not.toContain("SourceApiJsonValue");
    expect(combined).not.toContain("toSourceApiJsonValue");
  });
});
