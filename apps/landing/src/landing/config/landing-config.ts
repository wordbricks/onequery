import type { BrandIconName } from "../content/brand-icons";

export const SECTION_IDS = {
  install: "install",
  roadmap: "roadmap",
  surface: "surface",
  workflow: "workflow",
} as const;

export const REPOSITORY_URL = "https://github.com/wordbricks/onequery" as const;
export const CLI_SOURCE_URL = `${REPOSITORY_URL}/tree/main/apps/cli` as const;
export const SELF_HOST_DOCS_URL =
  `${REPOSITORY_URL}/blob/main/docs/self-host.md` as const;
export const INSTALL_SCRIPT_URL = "https://onequery.dev/install.sh" as const;

export const DOWNLOAD_COMMAND =
  `curl -fsSL ${INSTALL_SCRIPT_URL} | sh` as const;

type InstallCommand = {
  command: string;
  iconName: BrandIconName;
  label: string;
};

// Note: README currently uses `bun add -g @onequery/cli`, while
// docs/self-host.md still says `bun install -g @onequery/cli`.
// Keep the README wording here until the docs are reconciled.
export const INSTALL_COMMANDS = [
  {
    command: "npm install -g @onequery/cli",
    iconName: "npm",
    label: "npm",
  },
  {
    command: "brew install wordbricks/tap/onequery",
    iconName: "homebrew",
    label: "Homebrew",
  },
  {
    command: "bun add -g @onequery/cli",
    iconName: "bun",
    label: "Bun",
  },
  {
    command: DOWNLOAD_COMMAND,
    iconName: "curl",
    label: "Install script",
  },
] as const satisfies readonly InstallCommand[];

export const COPY_FEEDBACK_RESET_DELAY_MS = 1500;
export const DEFAULT_DEV_PORT = 4546;
export const DEV_SERVER_HOST = "0.0.0.0" as const;
