import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function readServiceSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

describe("workflow replay protobuf boundary", () => {
  it("keeps replay projectors free of stored command payload Zod parsing", async () => {
    const [queryWorkflowCodec, sourceApiWorkflowCodec] = await Promise.all([
      readServiceSource("./query/workflow-codec.ts"),
      readServiceSource("./source-api/workflow-codec.ts"),
    ]);

    for (const source of [queryWorkflowCodec, sourceApiWorkflowCodec]) {
      expect(source).not.toContain('from "zod"');
      expect(source).not.toMatch(/safeParse\(\s*commandPayload/);
      expect(source).not.toMatch(/Stored[A-Za-z]+PayloadSchema/);
    }
  });

  it("keeps stored result command loading as the protobuf decode boundary", async () => {
    const [queryWorkflowRuntime, sourceApiWorkflowRuntime] = await Promise.all([
      readServiceSource("./query/workflow-runtime.ts"),
      readServiceSource("./source-api/workflow-runtime.ts"),
    ]);

    expect(queryWorkflowRuntime).toContain("decodeQueryActionCommandPayload(");
    expect(queryWorkflowRuntime).toContain("decodeQueryActionEventPayload(");
    expect(sourceApiWorkflowRuntime).toContain(
      "decodeSourceApiActionCommandPayload("
    );
    expect(sourceApiWorkflowRuntime).toContain(
      "decodeSourceApiActionEventPayload("
    );
  });
});
