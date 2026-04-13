import { describe, expect, it } from "vitest";

import {
  CLI_DEFAULT_POLL_AFTER_MS,
  CLI_DEFAULT_RELAY_TIMEOUT_MS,
  buildCliSourceConnectCommand,
  buildCliSourceShowCommand,
  buildCliApiExecuteCommand,
  buildCliApiIntegrationReminder,
  buildCliApiInspectCommand,
  deviceAuthorizationPollAfterMs,
  slowedDeviceAuthorizationPollAfterMs,
} from "./cli-defaults";

describe("cli defaults", () => {
  it("builds canonical CLI command strings for discovery surfaces", () => {
    expect({
      apiExecute: buildCliApiExecuteCommand("github"),
      apiInspect: buildCliApiInspectCommand("github"),
      integrationReminder: buildCliApiIntegrationReminder("GitHub", "github"),
      sourceConnect: buildCliSourceConnectCommand("postgres"),
      sourceShow: buildCliSourceShowCommand("warehouse"),
    }).toMatchSnapshot();
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
