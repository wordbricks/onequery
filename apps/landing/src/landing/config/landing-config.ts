export const SECTION_IDS = {
  install: "install",
  roadmap: "roadmap",
  surface: "surface",
  workflow: "workflow",
} as const;

export const REPOSITORY_URL = "https://github.com/wordbricks/onequery" as const;
export const REPOSITORY_RAW_URL =
  "https://raw.githubusercontent.com/wordbricks/onequery/main" as const;
export const CLI_SOURCE_URL = `${REPOSITORY_URL}/tree/main/apps/cli` as const;
export const SELF_HOST_DOCS_URL =
  `${REPOSITORY_URL}/blob/main/docs/self-host.md` as const;
export const PROTO_SOURCE_URL =
  `${REPOSITORY_RAW_URL}/proto/onequery/landing/v1/landing.proto` as const;
export const INSTALL_SCRIPT_URL = "https://onequery.dev/install.sh" as const;

export const DOWNLOAD_COMMAND =
  `curl -fsSL ${INSTALL_SCRIPT_URL} | sh` as const;

// Note: README currently uses `bun add -g @onequery/cli`, while
// docs/self-host.md still says `bun install -g @onequery/cli`.
// Keep the README wording here until the docs are reconciled.
export const INSTALL_COMMANDS = [
  {
    label: "Install script",
    command: DOWNLOAD_COMMAND,
  },
  {
    label: "Homebrew",
    command: "brew install wordbricks/tap/onequery",
  },
  {
    label: "npm",
    command: "npm install -g @onequery/cli",
  },
  {
    label: "Bun",
    command: "bun add -g @onequery/cli",
  },
] as const;

export const INSTALL_SNIPPET = `${DOWNLOAD_COMMAND}

onequery gateway start
onequery auth login` as const;

export const COPY_FEEDBACK_RESET_DELAY_MS = 1500;
export const DEFAULT_DEV_PORT = 4546;
export const DEV_SERVER_HOST = "0.0.0.0" as const;
