import { describe, expect, it } from "bun:test";

import { expandPackages } from "./stage-npm-packages.js";

describe("stage-npm-packages", () => {
  it("expands cli-install into the stable unix installer bundles", () => {
    expect(expandPackages(["cli-install"])).toEqual([
      "cli-install-darwin-arm64",
      "cli-install-darwin-x64",
      "cli-install-linux-arm64",
      "cli-install-linux-x64",
    ]);
  });
});
