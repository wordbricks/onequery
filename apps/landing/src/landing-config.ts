export const LANDING_SECTION_IDS = {
  install: "install",
  surface: "surface",
  workflow: "workflow",
} as const;

export const LANDING_REPOSITORY_URL =
  "https://github.com/wordbricks/onequery" as const;
export const LANDING_CLI_SOURCE_URL =
  `${LANDING_REPOSITORY_URL}/tree/main/apps/cli` as const;
export const LANDING_INSTALL_SCRIPT_URL =
  "https://onequery.wordbricks.ai/install.sh" as const;
const LANDING_LOCAL_SERVER_URL = "http://127.0.0.1:5656" as const;

export const LANDING_DOWNLOAD_COMMAND =
  `curl -fsSL ${LANDING_INSTALL_SCRIPT_URL} | sh` as const;

export const LANDING_INSTALL_SNIPPET = `${LANDING_DOWNLOAD_COMMAND}

onequery serve
onequery config set server ${LANDING_LOCAL_SERVER_URL}
onequery auth login` as const;

export const LANDING_COPY_FEEDBACK_RESET_DELAY_MS = 1500;
export const DEFAULT_LANDING_DEV_PORT = 4546;
export const LANDING_DEV_SERVER_HOST = "0.0.0.0" as const;
const PORT_DIGITS_PATTERN = /^\d+$/;

export function getLandingDevPort(
  envPort = process.env.ONEQUERY_LANDING_DEV_PORT
) {
  const trimmedPort = envPort?.trim();
  if (!trimmedPort) {
    return DEFAULT_LANDING_DEV_PORT;
  }

  if (!PORT_DIGITS_PATTERN.test(trimmedPort)) {
    return DEFAULT_LANDING_DEV_PORT;
  }

  const parsedPort = Number.parseInt(trimmedPort, 10);
  if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return DEFAULT_LANDING_DEV_PORT;
  }

  return parsedPort;
}
