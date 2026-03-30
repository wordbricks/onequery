export const CLI_DEVICE_AUTH_CLIENT_ID = "onequery-cli";
export const CLI_DEVICE_AUTH_CODE_PATH = "/api/auth/device/code";
export const CLI_DEVICE_AUTH_TOKEN_PATH = "/api/auth/device/token";
export const CLI_DEVICE_AUTH_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:device_code";
export const CLI_DEFAULT_LOGIN_TIMEOUT_SEC = 180;
export const CLI_DEFAULT_POLL_AFTER_MS = 5_000;
export const CLI_DEVICE_AUTH_SLOW_DOWN_INCREMENT_MS = 5_000;

export const CLI_DEFAULT_RELAY_TIMEOUT_MS = 30_000;

const CLI_JSON_INPUT_PLACEHOLDER = "'<json>'";

export function buildCliSourceConnectCommand(provider: string) {
  return `oneq source connect --source ${provider} --input ${CLI_JSON_INPUT_PLACEHOLDER}`;
}

export function buildCliSourceShowCommand(sourceKey: string) {
  return `oneq source show ${sourceKey}`;
}

export function buildCliUseInspectCommand(source: string) {
  return `oneq use --source ${source}`;
}

export function buildCliUseExecuteCommand(source: string) {
  return `oneq use --source ${source} --input ${CLI_JSON_INPUT_PLACEHOLDER}`;
}

export function buildCliUseIntegrationReminder(
  providerLabel: string,
  source: string
) {
  return `You should connect ${providerLabel} in OneQuery before using \`${buildCliUseInspectCommand(
    source
  )}\`.`;
}

export function deviceAuthorizationPollAfterMs(intervalSec?: number) {
  return (intervalSec ?? CLI_DEFAULT_POLL_AFTER_MS / 1000) * 1000;
}

export function slowedDeviceAuthorizationPollAfterMs() {
  return CLI_DEFAULT_POLL_AFTER_MS + CLI_DEVICE_AUTH_SLOW_DOWN_INCREMENT_MS;
}
