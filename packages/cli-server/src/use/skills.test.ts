import { describe, expect, it } from "vitest";

import { getCliUseIntegrationRequiredSkill, getCliUseSkill } from "./skills";

describe("use skills", () => {
  it("reuses canonical inspect and execute commands in relay skills", () => {
    const skill = getCliUseSkill("github");

    expect(skill.content).toContain(
      "Inspect this skill with `onequery use --source github`."
    );
    expect(skill.content).toContain(
      "Execute the relay with `onequery use --source github --input '<json>'`."
    );
  });

  it("reuses the canonical inspect command in integration-required guidance", () => {
    const skill = getCliUseIntegrationRequiredSkill({
      orgSlug: "acme",
      source: "github",
    });

    expect(skill.content).toContain(
      "You should connect GitHub in OneQuery before using `onequery use --source github`."
    );
    expect(skill.content).toContain("Rerun `onequery use --source github`.");
  });
});
