import {
  CLI_SOURCE_URL,
  INSTALL_SCRIPT_URL,
  REPOSITORY_URL,
} from "../landing/config/landing-config";

export type FooterLink = {
  href: string;
  label: string;
  trackingName?: string;
};

export const FOOTER_LINKS = [
  {
    href: REPOSITORY_URL,
    label: "GitHub",
    trackingName: "footer_github",
  },
  {
    href: CLI_SOURCE_URL,
    label: "CLI source",
    trackingName: "footer_cli_source",
  },
  {
    href: INSTALL_SCRIPT_URL,
    label: "Install script",
    trackingName: "footer_install_script",
  },
] satisfies ReadonlyArray<FooterLink>;

export const BLOG_FOOTER_LINKS = [
  {
    href: REPOSITORY_URL,
    label: "GitHub",
  },
] satisfies ReadonlyArray<FooterLink>;
