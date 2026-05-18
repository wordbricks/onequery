import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import plugin from "./index";

describe("openclaw plugin entry", () => {
  it("keeps the expected plugin metadata", () => {
    expect(plugin.id).toBe("onequery");
    expect(plugin.name).toBe("OneQuery");
    expect(plugin.description).toContain("onequery-openclaw");
  });

  it("does not register custom agent tools", async () => {
    const registerTool = vi.fn();

    await plugin.register({ registerTool } as never);

    expect(registerTool).not.toHaveBeenCalled();
  });

  it("publishes a compiled runtime entry for OpenClaw", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as {
      exports: { ".": { default: string } };
      files: string[];
      openclaw: { extensions: string[]; runtimeExtensions: string[] };
      scripts: Record<string, string>;
    };

    expect(packageJson.files).toContain("dist");
    expect(packageJson.exports["."].default).toBe("./dist/index.js");
    expect(packageJson.openclaw.extensions).toEqual(["./src/index.ts"]);
    expect(packageJson.openclaw.runtimeExtensions).toEqual(["./dist/index.js"]);
    expect(packageJson.scripts.build).toContain("bun build");
    expect(packageJson.scripts.prepack).toBe("bun run build");
  });

  it("keeps the compiled runtime entry importable", async () => {
    const runtime = (await import(
      new URL("../dist/index.js", import.meta.url).href
    )) as { default: typeof plugin };

    expect(runtime.default.id).toBe(plugin.id);
    expect(runtime.default.name).toBe(plugin.name);
    expect(runtime.default.description).toBe(plugin.description);
  });
});
