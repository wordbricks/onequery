import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateServerLaunchConfig } from "./server-launch";

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("server launch contract", () => {
  it("accepts the shared self-host launch fixture", () => {
    const fixturePath = resolve(fixtureDir, "self-host-launch.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

    expect(
      validateServerLaunchConfig(fixture, `fixture ${fixturePath}`)
    ).toEqual(fixture);
  });
});
