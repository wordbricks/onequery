import { describe, expect, it } from "vitest";

import {
  CLI_DEFAULT_POLL_AFTER_MS,
  CLI_DEFAULT_RELAY_TIMEOUT_MS,
  buildCliSourceConnectCommand,
  buildCliSourceShowCommand,
  buildCliUseExecuteCommand,
  buildCliUseIntegrationReminder,
  buildCliUseInspectCommand,
  deviceAuthorizationPollAfterMs,
  slowedDeviceAuthorizationPollAfterMs,
} from "./cli-defaults";

describe("cli defaults", () => {
  it("builds canonical CLI command strings for discovery surfaces", () => {
    expect(buildCliSourceConnectCommand("postgres")).toBe(
      "onequery source connect --source postgres --input '<json>'"
    );
    expect(buildCliSourceShowCommand("warehouse")).toBe(
      "onequery source show warehouse"
    );
    expect(buildCliUseInspectCommand("github")).toBe(
      "onequery use --source github"
    );
    expect(buildCliUseExecuteCommand("github")).toBe(
      "onequery use --source github --input '<json>'"
    );
    expect(buildCliUseIntegrationReminder("GitHub", "github")).toBe(
      "You should connect GitHub in OneQuery before using `onequery use --source github`."
    );
  });

  it("keeps device authorization polling defaults in milliseconds", () => {
    expect(CLI_DEFAULT_POLL_AFTER_MS).toBe(5_000);
    expect(deviceAuthorizationPollAfterMs()).toBe(5_000);
    expect(deviceAuthorizationPollAfterMs(9)).toBe(9_000);
    expect(slowedDeviceAuthorizationPollAfterMs()).toBe(10_000);
  });

  it("keeps relay examples aligned on the default timeout", () => {
    expect(CLI_DEFAULT_RELAY_TIMEOUT_MS).toBe(30_000);
  });
});
