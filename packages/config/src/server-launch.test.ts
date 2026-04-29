import { describe, expect, it } from "vitest";

import {
  decodeServerLaunchConfigJson,
  encodeServerLaunchConfigJson,
  validateServerLaunchConfig,
  viewServerLaunchConfig,
} from "./server-launch";
import {
  createSelfHostLaunchConfig,
  createWorkspaceDevLaunchConfig,
} from "./testing";

describe("server launch contract", () => {
  it("accepts a workspace-dev launch config sample", () => {
    const launchConfig = createWorkspaceDevLaunchConfig();

    expect(validateServerLaunchConfig(launchConfig, "test")).toEqual(
      launchConfig
    );
    expect(viewServerLaunchConfig(launchConfig, "test").mode).toBe(
      "workspace-dev"
    );
  });

  it("accepts a self-host launch config sample with runtime-only fields", () => {
    const launchConfig = createSelfHostLaunchConfig();

    expect(validateServerLaunchConfig(launchConfig, "test")).toEqual(
      launchConfig
    );
    expect(viewServerLaunchConfig(launchConfig, "test").mode).toBe("self-host");
  });

  it("encodes and decodes ProtoJSON using the generated schema", () => {
    const launchConfig = createWorkspaceDevLaunchConfig();
    const encoded = encodeServerLaunchConfigJson(launchConfig);
    const parsed = JSON.parse(encoded);

    expect(parsed).toHaveProperty("workspaceDev");
    expect(parsed.workspaceDev.common.crypto.masterEncryptionKey).toBe(
      "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="
    );
    expect(decodeServerLaunchConfigJson(encoded, "test")).toEqual(launchConfig);
  });

  it("requires the Rust-stamped supervisor identity for self-host runtime use", () => {
    const launchConfig = createSelfHostLaunchConfig();
    if (launchConfig.profile.case !== "selfHost") {
      throw new Error("expected self-host launch config");
    }

    launchConfig.profile.value.supervisor = undefined;

    expect(() => validateServerLaunchConfig(launchConfig, "test")).toThrow(
      "selfHost.supervisor"
    );
  });
});
