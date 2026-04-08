import assert from "node:assert/strict";
import test from "node:test";

import { buildFormula } from "./generate-homebrew-formula.js";

void test("buildFormula renders the supported platform download blocks", () => {
  const formula = buildFormula({
    repoName: "onequery",
    repoOwner: "wordbricks",
    sha256ByPlatform: {
      darwinArm64: "1".repeat(64),
      darwinX64: "2".repeat(64),
      linuxArm64: "3".repeat(64),
      linuxX64: "4".repeat(64),
    },
    version: "1.2.3",
  });

  assert.match(
    formula,
    /url "https:\/\/github\.com\/wordbricks\/onequery\/releases\/download\/cli-v1\.2\.3\/onequery-npm-darwin-arm64\.tgz"/
  );
  assert.match(
    formula,
    /url "https:\/\/github\.com\/wordbricks\/onequery\/releases\/download\/cli-v1\.2\.3\/onequery-npm-linux-x64\.tgz"/
  );
  assert.match(formula, /\(bin\/"onequery"\)\.write_env_script\(/);
  assert.match(
    formula,
    /ONEQUERY_RUNTIME_ROOT: libexec\/"vendor\/#\{target_triple\}"/
  );
});

void test("buildFormula omits optional Linux arm64 downloads when no checksum is provided", () => {
  const formula = buildFormula({
    repoName: "onequery",
    repoOwner: "wordbricks",
    sha256ByPlatform: {
      darwinArm64: "1".repeat(64),
      darwinX64: "2".repeat(64),
      linuxX64: "4".repeat(64),
    },
    version: "1.2.3",
  });

  assert.doesNotMatch(formula, /onequery-npm-linux-arm64\.tgz/);
  assert.match(formula, /onequery-npm-linux-x64\.tgz/);
});
