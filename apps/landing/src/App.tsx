import { useEffect, useReducer, useRef, useState } from "react";

import {
  trackInstallCommandCopied,
  trackInstallMethodSelected,
  trackLandingCtaClick,
  trackPageView,
} from "./analytics";
import {
  LANDING_CLI_SOURCE_URL,
  LANDING_COPY_FEEDBACK_RESET_DELAY_MS,
  LANDING_INSTALL_COMMANDS,
  LANDING_DOWNLOAD_COMMAND,
  LANDING_INSTALL_SCRIPT_URL,
  LANDING_REPOSITORY_URL,
  LANDING_SECTION_IDS,
  LANDING_SELF_HOST_DOCS_URL,
} from "./landing-config";
import { FooterContactButton, ProductUpdatesSection } from "./marketing-forms";

const querySnippet = `onequery query exec \\
  --source warehouse \\
  --sql "select date_trunc('day', occurred_at) as day, \\
                sum(total_usd) as spend \\
         from agent_runs \\
         group by 1 \\
         order by 1 desc \\
         limit 7"`;

const queryDetailsSnippet = `source       warehouse
policy       read-only passed
statement    single statement
duration     842 ms
rows         7 returned
budget       $4.2k remaining`;

type TerminalLine = {
  kind: "prompt" | "continuation" | "output";
  text: string;
};

const quickstartTerminalLines: TerminalLine[] = [
  { kind: "prompt", text: LANDING_DOWNLOAD_COMMAND },
  { kind: "output", text: "downloaded @onequery/cli to ~/.local/bin" },
  { kind: "prompt", text: "onequery gateway start" },
  { kind: "output", text: "gateway listening on http://localhost:5656" },
  { kind: "prompt", text: "onequery auth login" },
  { kind: "output", text: "signed in as owner@acme.dev · org acme-org" },
];

const queryTerminalLines: TerminalLine[] = [
  ...querySnippet.split("\n").map(
    (line, index): TerminalLine => ({
      kind: index === 0 ? "prompt" : "continuation",
      text: line,
    })
  ),
  { kind: "output", text: "7 rows returned from warehouse · 842 ms" },
  { kind: "output", text: "latest day: 2026-04-13 · spend: $12,481.32" },
];

const navigationItems = [
  { href: `#${LANDING_SECTION_IDS.surface}`, label: "Product" },
  { href: `#${LANDING_SECTION_IDS.install}`, label: "Install" },
  { href: `#${LANDING_SECTION_IDS.workflow}`, label: "Workflow" },
];

const heroSignals = [
  "Self-host the gateway with `onequery gateway start`.",
  "Keep the CLI and browser pointed at the same runtime state.",
  "Centralize budgets, policies, and source access in one control plane.",
];

const _featureRows = [
  {
    eyebrow: "Unified Sources",
    title: "One gateway for all your data.",
    body: "Register SQL databases, analytics vendors, and SaaS APIs in a single self-hosted runtime. No per-tool access rules.",
    points: [
      "PostgreSQL, MySQL, MongoDB, BigQuery, GitHub, Linear, and more.",
      "Provider-specific connect flows from the CLI or browser.",
      "Customer-side connectors for credentials that must stay private.",
    ],
    mediaBadge: "Source catalog",
    mediaKind: "integrations",
  },
  {
    eyebrow: "Safety & Observability",
    title: "See every query before it runs.",
    body: "Preview, execute, inspect, and recover — with budget tracking and policy checks built in.",
    points: [
      "Read-only and single-statement safeguards.",
      "Budget status and remaining-limit context per provider.",
      "Failure and retry paths as visible workflow steps.",
    ],
    mediaBadge: "Query observability",
    mediaKind: "audit",
  },
] satisfies Array<{
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  mediaBadge: string;
  mediaKind: MockSurfaceKind;
}>;

const controlPlaneInputs = [
  { key: "member-a", label: "Engineer", kind: "human" },
  { key: "member-b", label: "Analyst", kind: "human" },
  { key: "member-c", label: "CI agent", kind: "bot" },
  { key: "member-d", label: "AI agent", kind: "bot" },
] satisfies Array<{
  key: string;
  label: string;
  kind: "human" | "bot";
}>;

const brandIcons: Record<string, string> = {
  postgresql:
    "M23.5594 14.7228a.5269.5269 0 0 0-.0563-.1191c-.139-.2632-.4768-.3418-1.0074-.2321-1.6533.3411-2.2935.1312-2.5256-.0191 1.342-2.0482 2.445-4.522 3.0411-6.8297.2714-1.0507.7982-3.5237.1222-4.7316a1.5641 1.5641 0 0 0-.1509-.235C21.6931.9086 19.8007.0248 17.5099.0005c-1.4947-.0158-2.7705.3461-3.1161.4794a9.449 9.449 0 0 0-.5159-.0816 8.044 8.044 0 0 0-1.3114-.1278c-1.1822-.0184-2.2038.2642-3.0498.8406-.8573-.3211-4.7888-1.645-7.2219.0788C.9359 2.1526.3086 3.8733.4302 6.3043c.0409.818.5069 3.334 1.2423 5.7436.4598 1.5065.9387 2.7019 1.4334 3.582.553.9942 1.1259 1.5933 1.7143 1.7895.4474.1491 1.1327.1441 1.8581-.7279.8012-.9635 1.5903-1.8258 1.9446-2.2069.4351.2355.9064.3625 1.39.3772a.0569.0569 0 0 0 .0004.0041 11.0312 11.0312 0 0 0-.2472.3054c-.3389.4302-.4094.5197-1.5002.7443-.3102.064-1.1344.2339-1.1464.8115-.0025.1224.0329.2309.0919.3268.2269.4231.9216.6097 1.015.6331 1.3345.3335 2.5044.092 3.3714-.6787-.017 2.231.0775 4.4174.3454 5.0874.2212.5529.7618 1.9045 2.4692 1.9043.2505 0 .5263-.0291.8296-.0941 1.7819-.3821 2.5557-1.1696 2.855-2.9059.1503-.8707.4016-2.8753.5388-4.1012.0169-.0703.0357-.1207.057-.1362.0007-.0005.0697-.0471.4272.0307a.3673.3673 0 0 0 .0443.0068l.2539.0223.0149.001c.8468.0384 1.9114-.1426 2.5312-.4308.6438-.2988 1.8057-1.0323 1.5951-1.6698z",
  mongodb:
    "M17.193 9.555c-1.264-5.58-4.252-7.414-4.573-8.115-.28-.394-.53-.954-.735-1.44-.036.495-.055.685-.523 1.184-.723.566-4.438 3.682-4.74 10.02-.282 5.912 4.27 9.435 4.888 9.884l.07.05A73.49 73.49 0 0111.91 24h.481c.114-1.032.284-2.056.51-3.07.417-.296.604-.463.85-.693a11.342 11.342 0 003.639-8.464c.01-.814-.103-1.662-.197-2.218zm-5.336 8.195s0-8.291.275-8.29c.213 0 .49 10.695.49 10.695-.381-.045-.765-1.76-.765-2.405z",
  mysql:
    "M16.405 5.501c-.115 0-.193.014-.274.033v.013h.014c.054.104.146.18.214.273.054.107.1.214.154.32l.014-.015c.094-.066.14-.172.14-.333-.04-.047-.046-.094-.08-.14-.04-.067-.126-.1-.18-.153zM5.77 18.695h-.927a50.854 50.854 0 00-.27-4.41h-.008l-1.41 4.41H2.45l-1.4-4.41h-.01a72.892 72.892 0 00-.195 4.41H0c.055-1.966.192-3.81.41-5.53h1.15l1.335 4.064h.008l1.347-4.064h1.095c.242 2.015.384 3.86.428 5.53zm4.017-4.08c-.378 2.045-.876 3.533-1.492 4.46-.482.716-1.01 1.073-1.583 1.073-.153 0-.34-.046-.566-.138v-.494c.11.017.24.026.386.026.268 0 .483-.075.647-.222.197-.18.295-.382.295-.605 0-.155-.077-.47-.23-.944L6.23 14.615h.91l.727 2.36c.164.536.233.91.205 1.123.4-1.064.678-2.227.835-3.483zm12.325 4.08h-2.63v-5.53h.885v4.85h1.745zm-3.32.135l-1.016-.5c.09-.076.177-.158.255-.25.433-.506.648-1.258.648-2.253 0-1.83-.718-2.746-2.155-2.746-.704 0-1.254.232-1.65.697-.43.508-.646 1.256-.646 2.245 0 .972.19 1.686.574 2.14.35.41.877.615 1.583.615.264 0 .506-.033.725-.098l1.325.772.36-.622zM15.5 17.588c-.225-.36-.337-.94-.337-1.736 0-1.393.424-2.09 1.27-2.09.443 0 .77.167.977.5.224.362.336.936.336 1.723 0 1.404-.424 2.108-1.27 2.108-.445 0-.77-.167-.978-.5zm-1.658-.425c0 .47-.172.856-.516 1.156-.344.3-.803.45-1.384.45-.543 0-1.064-.172-1.573-.515l.237-.476c.438.22.833.328 1.19.328.332 0 .593-.073.783-.22a.754.754 0 00.3-.615c0-.33-.23-.61-.648-.845-.388-.213-1.163-.657-1.163-.657-.422-.307-.632-.636-.632-1.177 0-.45.157-.81.47-1.085.315-.278.72-.415 1.22-.415.512 0 .98.136 1.4.41l-.213.476a2.726 2.726 0 00-1.064-.23c-.283 0-.502.068-.654.206a.685.685 0 00-.248.524c0 .328.234.61.666.85.393.215 1.187.67 1.187.67.433.305.648.63.648 1.168zm9.382-5.852c-.535-.014-.95.04-1.297.188-.1.04-.26.04-.274.167.055.053.063.14.11.214.08.134.218.313.346.407.14.11.28.216.427.31.26.16.555.255.81.416.145.094.293.213.44.313.073.05.12.14.214.172v-.02c-.046-.06-.06-.147-.105-.214-.067-.067-.134-.127-.2-.193a3.223 3.223 0 00-.695-.675c-.214-.146-.682-.35-.77-.595l-.013-.014c.146-.013.32-.066.46-.106.227-.06.435-.047.67-.106.106-.027.213-.06.32-.094v-.06c-.12-.12-.21-.283-.334-.395a8.867 8.867 0 00-1.104-.823c-.21-.134-.476-.22-.697-.334-.08-.04-.214-.06-.26-.127-.12-.146-.19-.34-.275-.514a17.69 17.69 0 01-.547-1.163c-.12-.262-.193-.523-.34-.763-.69-1.137-1.437-1.826-2.586-2.5-.247-.14-.543-.2-.856-.274-.167-.008-.334-.02-.5-.027-.11-.047-.216-.174-.31-.235-.38-.24-1.364-.76-1.644-.072-.18.434.267.862.422 1.082.115.153.26.328.34.5.047.116.06.235.107.356.106.294.207.622.347.897.073.14.153.287.247.413.054.073.146.107.167.227-.094.136-.1.334-.154.5-.24.757-.146 1.693.194 2.25.107.166.362.534.703.393.3-.12.234-.5.32-.835.02-.08.007-.133.048-.187v.015c.094.188.188.367.274.555.206.328.566.668.867.895.16.12.287.328.487.402v-.02h-.015c-.043-.058-.1-.086-.154-.133a3.445 3.445 0 01-.35-.4 8.76 8.76 0 01-.747-1.218c-.11-.21-.202-.436-.29-.643-.04-.08-.04-.2-.107-.24-.1.146-.247.273-.32.453-.127.288-.14.642-.188 1.01-.027.007-.014 0-.027.014-.214-.052-.287-.274-.367-.46-.2-.475-.233-1.238-.06-1.785.047-.14.247-.582.167-.716-.042-.127-.174-.2-.247-.303a2.478 2.478 0 01-.24-.427c-.16-.374-.24-.788-.414-1.162-.08-.173-.22-.354-.334-.513-.127-.18-.267-.307-.368-.52-.033-.073-.08-.194-.027-.274.014-.054.042-.075.094-.09.088-.072.335.022.422.062.247.1.455.194.662.334.094.066.195.193.315.226h.14c.214.047.455.014.655.073.355.114.675.28.962.46a5.953 5.953 0 012.085 2.286c.08.154.115.295.188.455.14.33.313.663.455.982.14.315.275.636.476.897.1.14.502.213.682.286.133.06.34.115.46.188.23.14.454.3.67.454.11.076.443.243.463.378z",
  bigquery:
    "M5.676 10.595h2.052v5.244a5.892 5.892 0 0 1-2.052-2.088v-3.156zm18.179 10.836a.504.504 0 0 1 0 .708l-1.716 1.716a.504.504 0 0 1-.708 0l-4.248-4.248a.206.206 0 0 1-.007-.007c-.02-.02-.028-.045-.043-.066a10.736 10.736 0 0 1-6.334 2.065C4.835 21.599 0 16.764 0 10.799S4.835 0 10.8 0s10.799 4.835 10.799 10.8c0 2.369-.772 4.553-2.066 6.333.025.017.052.028.074.05l4.248 4.248zm-5.028-10.632a8.015 8.015 0 1 0-8.028 8.028h.024a8.016 8.016 0 0 0 8.004-8.028zm-4.86 4.98a6.002 6.002 0 0 0 2.04-2.184v-1.764h-2.04v3.948zm-4.5.948c.442.057.887.08 1.332.072.4.025.8.025 1.2 0V7.692H9.468v9.035z",
  snowflake:
    "M24 3.459c0 .646-.418 1.18-1.141 1.18-.723 0-1.142-.534-1.142-1.18 0-.647.419-1.18 1.142-1.18.723 0 1.141.533 1.141 1.18zm-.228 0c0-.533-.38-.951-.913-.951s-.913.38-.913.95c0 .533.38.952.913.952.57 0 .913-.419.913-.951zm-1.37-.533h.495c.266 0 .456.152.456.38 0 .153-.076.229-.19.305l.19.266v.038h-.266l-.19-.266h-.229v.266h-.266zm.495.228h-.229v.267h.229c.114 0 .152-.038.152-.114.038-.077-.038-.153-.152-.153zM7.602 12.4c.038-.151.076-.304.076-.456 0-.114-.038-.228-.038-.342-.114-.343-.304-.647-.646-.838l-4.87-2.777c-.685-.38-1.56-.152-1.94.533-.381.685-.153 1.56.532 1.94l2.701 1.56-2.701 1.56c-.685.38-.913 1.256-.533 1.94.38.685 1.256.914 1.94.533l4.832-2.777c.343-.267.571-.533.647-.876zm1.332 2.626c-.266-.038-.57.038-.837.19l-4.832 2.777c-.685.38-.913 1.256-.532 1.94.38.686 1.255.914 1.94.533l2.701-1.56v3.12c0 .8.647 1.408 1.446 1.408.799 0 1.407-.647 1.407-1.408v-5.592c0-.761-.57-1.37-1.293-1.408zm4.946-6.088c.266.038.57-.038.837-.19l4.832-2.777c.685-.38.913-1.256.532-1.94-.38-.686-1.255-.914-1.94-.533l-2.701 1.56V1.975c0-.799-.647-1.408-1.446-1.408-.799 0-1.446.609-1.446 1.408V7.53c0 .76.609 1.37 1.332 1.407zM3.265 5.97l4.832 2.777c.266.152.533.19.837.19.723-.038 1.331-.684 1.331-1.407V1.975c0-.799-.646-1.408-1.407-1.408-.799 0-1.446.647-1.446 1.408v3.12l-2.701-1.56c-.685-.38-1.56-.152-1.94.533-.419.646-.19 1.521.494 1.902zm9.093 6.011a.412.412 0 00-.114-.266l-.57-.571a.346.346 0 00-.267-.114.412.412 0 00-.266.114l-.571.57a.411.411 0 00-.114.267c0 .076.038.19.114.267l.57.57a.345.345 0 00.267.114c.076 0 .19-.038.266-.114l.571-.57a.412.412 0 00.114-.267zm1.598.533L11.94 14.53c-.039.038-.153.114-.229.114h-.608a.411.411 0 01-.267-.114L8.82 12.514a.408.408 0 01-.076-.229v-.608c0-.076.038-.19.114-.267l2.016-2.016a.41.41 0 01.267-.114h.608a.41.41 0 01.267.114l2.016 2.016a.347.347 0 01.114.267v.608c-.076.077-.114.19-.19.229zm5.593 5.44l-4.832-2.777c-.266-.152-.57-.19-.837-.152-.723.038-1.332.684-1.332 1.408v5.554c0 .8.647 1.408 1.408 1.408.799 0 1.446-.647 1.446-1.408v-3.12l2.7 1.56c.686.38 1.561.152 1.941-.533.419-.646.19-1.521-.494-1.94zm2.549-7.533l-2.701 1.56 2.7 1.56c.686.38.914 1.256.533 1.94-.38.685-1.255.913-1.94.533l-4.832-2.778a1.644 1.644 0 01-.647-.798c-.037-.153-.076-.305-.076-.457 0-.114.039-.228.039-.342.114-.343.342-.647.646-.837l4.832-2.778c.685-.38 1.56-.152 1.94.533.457.609.19 1.484-.494 1.864",
  notion:
    "M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z",
  googledrive:
    "M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z",
  github:
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  linear:
    "M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z",
};

type OutputNode = {
  key: string;
  label: string;
  icons: string[];
};

const controlPlaneOutputs: OutputNode[] = [
  {
    key: "database",
    label: "Databases",
    icons: ["postgresql", "mysql", "mongodb"],
  },
  { key: "analytics", label: "Analytics", icons: ["bigquery", "snowflake"] },
  {
    key: "documents",
    label: "Internal docs",
    icons: ["notion", "googledrive"],
  },
  { key: "code", label: "Code", icons: ["github", "linear"] },
];

const controlPlanePolicies = [
  "Safe query screening",
  "Budget control",
  "Audit log",
  "Permission control",
];

const installSteps = [
  "Install the CLI with the script, Homebrew, npm, or Bun.",
  "Start the self-hosted gateway with `onequery gateway start`.",
  "Open the local UI to bootstrap the first user, then run `onequery auth login`.",
  "Connect a source and execute queries from the CLI or the browser against the same gateway.",
];

const footerLinks = [
  { href: LANDING_REPOSITORY_URL, label: "GitHub" },
  { href: LANDING_CLI_SOURCE_URL, label: "CLI source" },
  { href: LANDING_INSTALL_SCRIPT_URL, label: "Install script" },
];

function DownloadCommand() {
  const [selectedMethodLabel, setSelectedMethodLabel] = useState<string>(
    LANDING_INSTALL_COMMANDS[0].label
  );
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  async function handleCopy(label: string, command: string) {
    try {
      await navigator.clipboard.writeText(command);
      trackInstallCommandCopied(label);
      setCopiedLabel(label);

      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }

      resetTimerRef.current = window.setTimeout(() => {
        setCopiedLabel(null);
      }, LANDING_COPY_FEEDBACK_RESET_DELAY_MS);
    } catch {
      setCopiedLabel(null);
    }
  }

  const selectedMethod =
    LANDING_INSTALL_COMMANDS.find(
      (method) => method.label === selectedMethodLabel
    ) ?? LANDING_INSTALL_COMMANDS[0];

  return (
    <div className="install-selector">
      <div className="install-tabs" role="tablist" aria-label="Install method">
        {LANDING_INSTALL_COMMANDS.map((method) => {
          const isSelected = method.label === selectedMethod.label;

          return (
            <button
              key={method.label}
              id={`install-tab-${method.label}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls="install-command-panel"
              className={`install-tab ${isSelected ? "install-tab-active" : ""}`}
              onClick={() => {
                trackInstallMethodSelected(method.label);
                setSelectedMethodLabel(method.label);
              }}
            >
              {method.label}
            </button>
          );
        })}
      </div>

      <div
        id="install-command-panel"
        className="download-command"
        role="tabpanel"
        aria-labelledby={`install-tab-${selectedMethod.label}`}
      >
        <span className="download-command-label">{selectedMethod.label}</span>
        <code>{selectedMethod.command}</code>
        <button
          type="button"
          className="install-method-copy"
          onClick={() =>
            handleCopy(selectedMethod.label, selectedMethod.command)
          }
          aria-label={`Copy ${selectedMethod.label} install command`}
        >
          {copiedLabel === selectedMethod.label ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

type MockSurfaceKind = "hero" | "integrations" | "audit";

type TuiEntry = {
  label: string;
  meta?: string;
  active?: boolean;
};

type HeroProductTab = "integrations" | "query" | "audit";
type SafeQueryCheckId = "nonDestructive" | "budgetLimit" | "accessPermission";
type SafeQueryCheckStatus = "pending" | "success" | "failure";
type SafeQueryResult = "pending" | "pass" | "blocked";

const heroSafeQueryChecks = [
  { id: "nonDestructive", label: "Non-destructive" },
  { id: "budgetLimit", label: "budget limit" },
  { id: "accessPermission", label: "access permission" },
] satisfies Array<{ id: SafeQueryCheckId; label: string }>;

const heroSafeQueryScenarios = [
  { result: "pass" },
  { result: "blocked", failingStepId: "budgetLimit" },
] satisfies Array<
  | { result: "pass"; failingStepId?: undefined }
  | {
      result: "blocked";
      failingStepId: SafeQueryCheckId;
    }
>;

const SAFE_QUERY_INITIAL_DELAY_MS = 360;
const SAFE_QUERY_STEP_DELAY_MS = 520;
const SAFE_QUERY_RESULT_HOLD_MS = 900;
const SAFE_QUERY_FULL_CYCLE_MS =
  SAFE_QUERY_INITIAL_DELAY_MS +
  heroSafeQueryChecks.length * SAFE_QUERY_STEP_DELAY_MS +
  SAFE_QUERY_RESULT_HOLD_MS;
const SAFE_QUERY_TAB_MIN_DWELL_MS = 6500;
const HERO_TAB_DWELL_MS = {
  audit: 5000,
  integrations: 5000,
  // Keep the hero on safe query long enough to show the full checklist pass.
  query: Math.max(SAFE_QUERY_TAB_MIN_DWELL_MS, SAFE_QUERY_FULL_CYCLE_MS + 1800),
} satisfies Record<HeroProductTab, number>;

type SafeQueryAnimationState = {
  cycleIndex: number;
  statuses: Record<SafeQueryCheckId, SafeQueryCheckStatus>;
  result: SafeQueryResult;
};

type SafeQueryAnimationAction = { type: "advance" } | { type: "restart" };

function createSafeQueryStatuses(): Record<
  SafeQueryCheckId,
  SafeQueryCheckStatus
> {
  return {
    nonDestructive: "pending",
    budgetLimit: "pending",
    accessPermission: "pending",
  };
}

const initialSafeQueryAnimationState: SafeQueryAnimationState = {
  cycleIndex: 0,
  statuses: createSafeQueryStatuses(),
  result: "pending",
};

function safeQueryAnimationReducer(
  state: SafeQueryAnimationState,
  action: SafeQueryAnimationAction
): SafeQueryAnimationState {
  switch (action.type) {
    case "advance": {
      if (state.result !== "pending") {
        return state;
      }

      const scenario =
        heroSafeQueryScenarios[
          state.cycleIndex % heroSafeQueryScenarios.length
        ];

      if (scenario === undefined) {
        return state;
      }
      const nextCheck = heroSafeQueryChecks.find(
        (check) => state.statuses[check.id] === "pending"
      );

      if (nextCheck === undefined) {
        return state;
      }

      const nextStatus =
        scenario.result === "blocked" && scenario.failingStepId === nextCheck.id
          ? "failure"
          : "success";
      const nextStatuses = {
        ...state.statuses,
        [nextCheck.id]: nextStatus,
      };

      if (nextStatus === "failure") {
        return {
          ...state,
          statuses: nextStatuses,
          result: "blocked",
        };
      }

      const hasPendingChecks = heroSafeQueryChecks.some(
        (check) => nextStatuses[check.id] === "pending"
      );

      return {
        ...state,
        statuses: nextStatuses,
        result: hasPendingChecks ? "pending" : "pass",
      };
    }

    case "restart":
      return {
        cycleIndex: state.cycleIndex + 1,
        statuses: createSafeQueryStatuses(),
        result: "pending",
      };

    default:
      return state;
  }
}

function TuiSurface({
  tags,
  entries,
  footer,
  variant = "panel",
}: {
  tags: string[];
  entries: TuiEntry[];
  footer: string;
  variant?: "hero" | "panel";
}) {
  return (
    <div className={`tui-stage tui-stage-${variant}`}>
      <div className="tui-stage-grain" aria-hidden="true" />
      <div className="tui-window">
        <div className="tui-window-panel">
          <div className="tui-window-tags">
            {tags.map((tag, index) => (
              <span
                key={tag}
                className={index === 0 ? "tui-window-tag-primary" : ""}
              >
                {tag}
              </span>
            ))}
          </div>

          <div className="tui-window-steps">
            {entries.map((entry) => (
              <div
                key={entry.label}
                className={`tui-step ${entry.active ? "tui-step-active" : "tui-step-muted"}`}
              >
                <span className="tui-step-dot" aria-hidden="true" />
                <span className="tui-step-label">{entry.label}</span>
                {entry.meta ? (
                  <span className="tui-step-meta">{entry.meta}</span>
                ) : null}
              </div>
            ))}
          </div>

          <div className="tui-window-footer">{footer}</div>
        </div>
      </div>
    </div>
  );
}

function SafeQueryPanel() {
  const [state, dispatch] = useReducer(
    safeQueryAnimationReducer,
    initialSafeQueryAnimationState
  );

  // Safe-query feedback loops through explicit reducer transitions so the
  // mock stays deterministic across pass and blocked scenarios.
  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => {
        if (state.result === "pending") {
          dispatch({ type: "advance" });
          return;
        }

        dispatch({ type: "restart" });
      },
      state.result === "pending" &&
        heroSafeQueryChecks.every(
          (check) => state.statuses[check.id] === "pending"
        )
        ? SAFE_QUERY_INITIAL_DELAY_MS
        : state.result === "pending"
          ? SAFE_QUERY_STEP_DELAY_MS
          : SAFE_QUERY_RESULT_HOLD_MS
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [state]);

  return (
    <div
      className="hero-safe-query"
      data-result={state.result}
      aria-label="Safe querying checks"
    >
      <div className="hero-safe-query-preview">
        <span className="hero-safe-query-preview-line hero-safe-query-preview-line-primary">
          query
        </span>
        <span className="hero-safe-query-preview-line">content</span>
        <span className="hero-safe-query-preview-line">content</span>
      </div>

      <div className="hero-safe-query-sidebar">
        <div className="hero-safe-query-checklist" aria-live="polite">
          {heroSafeQueryChecks.map((check) => {
            const status = state.statuses[check.id];
            const indicator =
              status === "success" ? "✓" : status === "failure" ? "×" : "";

            return (
              <div
                key={check.id}
                className="hero-safe-query-check"
                data-status={status}
              >
                <span className="hero-safe-query-check-box" aria-hidden="true">
                  {indicator}
                </span>
                <span>{check.label}</span>
              </div>
            );
          })}
        </div>

        <div className="hero-safe-query-result-wrap">
          <div className="hero-safe-query-result" data-result={state.result}>
            {state.result === "blocked"
              ? "BLOCKED"
              : state.result === "pass"
                ? "PASS"
                : "CHECKING"}
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroDashboardSurface() {
  const [activeTab, setActiveTab] = useState<HeroProductTab>("integrations");

  const navItems: Array<{ id: HeroProductTab; label: string }> = [
    { id: "integrations", label: "Integrations" },
    { id: "query", label: "Safe query" },
    { id: "audit", label: "Audit log" },
  ];

  useEffect(() => {
    const tabOrder: HeroProductTab[] = ["integrations", "query", "audit"];
    const timeoutId = window.setTimeout(() => {
      setActiveTab((currentTab) => {
        const currentIndex = tabOrder.indexOf(currentTab);
        const nextIndex = (currentIndex + 1) % tabOrder.length;
        // The order is fixed, but indexed access still widens to `undefined`.
        const nextTab = tabOrder[nextIndex];
        return nextTab === undefined ? "integrations" : nextTab;
      });
    }, HERO_TAB_DWELL_MS[activeTab]);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeTab]);

  function renderTabContent() {
    switch (activeTab) {
      case "integrations":
        return (
          <div className="hero-product-list">
            <div className="hero-product-row">
              <span>warehouse</span>
              <span>postgres</span>
              <span>ready</span>
            </div>
            <div className="hero-product-row">
              <span>product-gh</span>
              <span>github</span>
              <span>ready</span>
            </div>
            <div className="hero-product-row">
              <span>spend</span>
              <span>bigquery</span>
              <span>pending</span>
            </div>
            <div className="hero-product-row">
              <span>events</span>
              <span>mongodb</span>
              <span>ready</span>
            </div>
          </div>
        );
      case "query":
        return <SafeQueryPanel />;
      case "audit":
        return (
          <div className="hero-product-audit">
            <div className="hero-product-audit-item">
              <span className="hero-product-audit-dot" aria-hidden="true" />
              <div>
                <p>owner@acme.dev executed query on warehouse</p>
                <span>842 ms · succeeded</span>
              </div>
            </div>
            <div className="hero-product-audit-item">
              <span className="hero-product-audit-dot" aria-hidden="true" />
              <div>
                <p>ops@acme.dev reviewed bigquery budget window</p>
                <span>pending provider refresh</span>
              </div>
            </div>
            <div className="hero-product-audit-item">
              <span className="hero-product-audit-dot" aria-hidden="true" />
              <div>
                <p>agent@acme.dev retry queued for athena-prod</p>
                <span>retry available</span>
              </div>
            </div>
          </div>
        );
    }
  }

  const tabMeta = {
    integrations: { title: "Multiple integrations", tag: "multi-source" },
    query: { title: "Safe querying", tag: "read-only" },
    audit: { title: "Audit log", tag: "latest" },
  } satisfies Record<HeroProductTab, { title: string; tag: string }>;

  return (
    <div
      className="hero-product-surface"
      aria-label="OneQuery product overview"
    >
      <aside className="hero-product-sidebar">
        <div className="hero-product-brand">
          <span className="hero-product-brand-mark" aria-hidden="true" />
          <div>
            <p>OneQuery</p>
            <span>acme-org</span>
          </div>
        </div>

        <div className="hero-product-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                item.id === activeTab
                  ? "hero-product-nav-button hero-product-nav-active"
                  : "hero-product-nav-button"
              }
              onClick={() => setActiveTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="hero-product-sidebar-footer">gateway running</div>
      </aside>

      <div className="hero-product-main">
        <div className="hero-product-header">
          <div>
            <h3>Welcome to OneQuery</h3>
            <p>
              Connect sources, run safe queries, and review organization
              history.
            </p>
          </div>
          <div className="hero-product-header-meta">
            <span>12 sources</span>
            <span>budget healthy</span>
          </div>
        </div>

        <section className="hero-product-focus">
          <div className="hero-product-section-header">
            <h4>{tabMeta[activeTab].title}</h4>
            <span>{tabMeta[activeTab].tag}</span>
          </div>
          <div className="hero-product-panel-body">
            <div
              key={activeTab}
              className="hero-product-panel"
              data-tab={activeTab}
            >
              {renderTabContent()}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ControlPlaneDiagram() {
  return (
    <div
      className="control-plane-diagram"
      role="img"
      aria-label="OneQuery sits between agents and tools on one side and databases, analytics, internal docs, and code on the other, applying safe query screening, budget control, audit logging, and permission control."
    >
      <svg
        className="control-plane-diagram-lines"
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        {/* left → core */}
        <line
          className="control-plane-line"
          x1="22%"
          y1="17.1%"
          x2="33.5%"
          y2="50%"
        />
        <line
          className="control-plane-line control-plane-line-delay-1"
          x1="22%"
          y1="39%"
          x2="33.5%"
          y2="50%"
        />
        <line
          className="control-plane-line control-plane-line-delay-2"
          x1="22%"
          y1="61%"
          x2="33.5%"
          y2="50%"
        />
        <line
          className="control-plane-line control-plane-line-delay-3"
          x1="22%"
          y1="82.9%"
          x2="33.5%"
          y2="50%"
        />
        {/* core → right */}
        <line
          className="control-plane-line control-plane-line-delay-2"
          x1="58.5%"
          y1="50%"
          x2="70%"
          y2="17.1%"
        />
        <line
          className="control-plane-line"
          x1="58.5%"
          y1="50%"
          x2="70%"
          y2="39%"
        />
        <line
          className="control-plane-line control-plane-line-delay-3"
          x1="58.5%"
          y1="50%"
          x2="70%"
          y2="61%"
        />
        <line
          className="control-plane-line control-plane-line-delay-1"
          x1="58.5%"
          y1="50%"
          x2="70%"
          y2="82.9%"
        />
      </svg>

      <div className="control-plane-column control-plane-column-left">
        {controlPlaneInputs.map((node, index) => (
          <div
            key={node.key}
            className={`control-plane-member-wrap control-plane-member-index-${index + 1}`}
          >
            <article className="control-plane-member" aria-label={node.label}>
              <ControlPlaneInputIcon kind={node.kind} />
            </article>
            <span className="control-plane-member-label">{node.label}</span>
          </div>
        ))}
      </div>

      <div className="control-plane-core">
        <div className="control-plane-core-shell">
          <p className="control-plane-core-kicker">Unified control plane</p>
          <div className="control-plane-core-brand">
            <img
              src="/onequery-icon.png"
              alt=""
              aria-hidden="true"
              className="control-plane-core-logo"
            />
            <h3>OneQuery</h3>
          </div>
          <div className="control-plane-capability-list">
            {controlPlanePolicies.map((policy) => (
              <div key={policy} className="control-plane-capability-row">
                <span
                  className="control-plane-capability-dot"
                  aria-hidden="true"
                />
                <span>{policy}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="control-plane-column control-plane-column-right">
        {controlPlaneOutputs.map((node, index) => (
          <article
            key={node.key}
            className={`control-plane-node control-plane-node-output control-plane-output-index-${index + 1}`}
          >
            <span className="control-plane-node-label">{node.label}</span>
            <div className="control-plane-node-icons">
              {node.icons.map((icon) => (
                <BrandIcon key={icon} name={icon} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function BrandIcon({ name }: { name: string }) {
  const d = brandIcons[name];
  if (!d) return null;
  return (
    <svg
      className="brand-icon"
      viewBox="0 0 24 24"
      aria-label={name}
      role="img"
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}

function ControlPlaneInputIcon({ kind }: { kind: "human" | "bot" }) {
  if (kind === "human") {
    return (
      <svg
        className="control-plane-member-icon"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5.5 18.25C6.5 14.95 8.82 13.3 12 13.3C15.18 13.3 17.5 14.95 18.5 18.25" />
      </svg>
    );
  }

  return (
    <svg
      className="control-plane-member-icon"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect x="6" y="7" width="12" height="9" rx="2.5" />
      <path d="M12 7V4.75" />
      <path d="M8.75 16V18.75" />
      <path d="M15.25 16V18.75" />
      <circle cx="10" cy="11.5" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="14" cy="11.5" r="0.85" fill="currentColor" stroke="none" />
      <path d="M10 14H14" />
    </svg>
  );
}

function IntegrationsSurface() {
  return (
    <TuiSurface
      tags={["catalog", "providers", "connect"]}
      footer="postgres · github · bigquery · connector-backed sources"
      entries={[
        { label: "warehouse source ready", meta: "postgres" },
        { label: "product-gh app linked", meta: "github" },
        { label: "spend dataset pending auth", meta: "bigquery" },
        { label: "connect another source", active: true },
      ]}
    />
  );
}

function AuditSurface() {
  return (
    <TuiSurface
      tags={["audit", "budget", "retry"]}
      footer="warehouse succeeded · bigquery pending · athena retry available"
      entries={[
        { label: "owner@acme.dev · query execute", meta: "842ms" },
        { label: "ops@acme.dev · provider wait", meta: "pending" },
        { label: "agent@acme.dev · retry scheduled", meta: "failed" },
        { label: "record execution state", active: true },
      ]}
    />
  );
}

function TerminalSurface({
  title,
  lines,
  footer,
}: {
  title: string;
  lines: TerminalLine[];
  footer: string;
}) {
  return (
    <div className="terminal-surface" role="img" aria-label={title}>
      <div className="terminal-surface-toolbar">
        <div className="terminal-surface-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="terminal-surface-title">{title}</span>
      </div>

      <div className="terminal-surface-body">
        {lines.map((line) => (
          <div
            key={`${line.kind}-${line.text}`}
            className={`terminal-line terminal-line-${line.kind}`}
          >
            {line.kind === "output" ? null : (
              <span className="terminal-line-prefix" aria-hidden="true">
                {line.kind === "prompt" ? "$" : ">"}
              </span>
            )}
            <code>{line.text}</code>
          </div>
        ))}
      </div>

      <div className="terminal-surface-footer">
        <span>{footer}</span>
      </div>
    </div>
  );
}

function renderMockSurface(kind: MockSurfaceKind) {
  switch (kind) {
    case "hero":
      return <HeroDashboardSurface />;
    case "integrations":
      return <IntegrationsSurface />;
    case "audit":
      return <AuditSurface />;
  }
}

export function App() {
  useEffect(() => {
    trackPageView();
  }, []);

  return (
    <div className="page-shell">
      <header className="site-header">
        <a
          href="/"
          className="brand-mark"
          aria-label="OneQuery landing homepage"
        >
          <img
            src="/onequery-icon.png"
            alt=""
            aria-hidden="true"
            className="brand-mark-icon"
          />
          <span>OneQuery</span>
        </a>

        <nav className="site-nav" aria-label="Primary">
          {navigationItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={() =>
                trackLandingCtaClick(
                  "nav_section_link",
                  "header_nav",
                  item.href
                )
              }
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="header-actions">
          <a
            className="header-github-link"
            href={LANDING_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Open OneQuery GitHub repository"
            onClick={() =>
              trackLandingCtaClick(
                "header_github_repository",
                "header",
                LANDING_REPOSITORY_URL
              )
            }
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="header-github-link-icon"
            >
              <path d={brandIcons.github} fill="currentColor" />
            </svg>
          </a>
        </div>
      </header>

      <main className="page-main">
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">Open source, self-hostable</p>
            <h1>Data ready for AI agents.</h1>
            <p className="hero-body">
              One safe gateway connecting all data sources.
            </p>

            <DownloadCommand />

            <div className="hero-actions">
              <a
                className="button button-primary"
                href={`#${LANDING_SECTION_IDS.install}`}
                onClick={() =>
                  trackLandingCtaClick(
                    "hero_get_started",
                    "hero",
                    `#${LANDING_SECTION_IDS.install}`
                  )
                }
              >
                Get started
              </a>
              <a
                className="button button-secondary"
                href={LANDING_REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() =>
                  trackLandingCtaClick(
                    "hero_browse_repository",
                    "hero",
                    LANDING_REPOSITORY_URL
                  )
                }
              >
                Browse repository
              </a>
            </div>

            <ul className="hero-signals">
              {heroSignals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
          </div>

          <div className="hero-visual">{renderMockSurface("hero")}</div>
        </section>

        <section
          className="section section-summary"
          id={LANDING_SECTION_IDS.surface}
        >
          <div className="section-intro">
            <p className="eyebrow">What OneQuery does</p>
            <h2>
              A single query workspace across your internal data and external
              tools.
            </h2>
            <p>
              OneQuery sits between the tools asking for access and the systems
              holding the data, so teams can apply policy, budget, audit, and
              permission controls in one place.
            </p>
          </div>

          <ControlPlaneDiagram />
        </section>

        {/* Unified Sources / Safety & Observability feature rows — commented out pending decision
        <section className="section feature-stack">
          {_featureRows.map((feature, index) => (
            <article
              key={feature.title}
              className={`feature-row ${index % 2 === 1 ? "feature-row-reversed" : ""}`}
            >
              <div className="feature-copy">
                <p className="eyebrow">{feature.eyebrow}</p>
                <h2>{feature.title}</h2>
                <p>{feature.body}</p>
                <ul className="detail-list">
                  {feature.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>

              <div className="feature-media">
                {renderMockSurface(feature.mediaKind)}
              </div>
            </article>
          ))}
        </section>
        */}

        <section
          className="section utility-grid"
          id={LANDING_SECTION_IDS.install}
        >
          <article className="utility-panel">
            <p className="eyebrow">Install</p>
            <h2>Up and running in a few commands.</h2>
            <ol className="step-list">
              {installSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>

          <article className="utility-panel utility-panel-code">
            <p className="eyebrow">Quickstart</p>
            <TerminalSurface
              title="Terminal session"
              lines={quickstartTerminalLines}
              footer="ready to connect the first source"
            />
          </article>
        </section>

        <section
          className="section utility-grid utility-grid-offset"
          id={LANDING_SECTION_IDS.workflow}
        >
          <article className="utility-panel utility-panel-code workflow-panel-example">
            <p className="eyebrow">Query example</p>
            <TerminalSurface
              title="Query execution"
              lines={queryTerminalLines}
              footer="shared runtime state visible in CLI and browser"
            />
          </article>

          <article className="utility-panel workflow-panel-details">
            <p className="eyebrow">Query details</p>
            <h2>Review the result, guardrails, and cost context together.</h2>
            <p>
              The query surface is not only about SQL text. OneQuery keeps the
              source, read-only safeguards, execution time, row count, and
              budget context visible so operators can understand what just ran
              before sharing or retrying the request.
            </p>
            <pre className="workflow-block">{queryDetailsSnippet}</pre>
          </article>
        </section>

        <section className="section final-cta">
          <div className="final-cta-copy">
            <p className="eyebrow">
              Self-host or connect to an existing server
            </p>
            <h2>
              Deploy OneQuery in your environment for secure, controllable, and
              fully visible data operations.
            </h2>
            <p>
              OneQuery is an open-source platform for unified data querying.
              Self-host the full product with{" "}
              <code>onequery gateway start</code>, connect databases, analytics
              tools, and APIs from one place, and give operators and AI agents a
              shared surface for access, execution, and recovery.
            </p>
          </div>

          <div className="final-cta-actions">
            <a
              className="button button-primary"
              href={LANDING_INSTALL_SCRIPT_URL}
              target="_blank"
              rel="noreferrer"
              onClick={() =>
                trackLandingCtaClick(
                  "final_install_now",
                  "final_cta",
                  LANDING_INSTALL_SCRIPT_URL
                )
              }
            >
              Install now
            </a>
            <a
              className="button button-secondary"
              href={LANDING_SELF_HOST_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              onClick={() =>
                trackLandingCtaClick(
                  "final_read_self_host_docs",
                  "final_cta",
                  LANDING_SELF_HOST_DOCS_URL
                )
              }
            >
              Read self-host docs
            </a>
          </div>
        </section>

        <ProductUpdatesSection />
      </main>

      <footer className="site-footer">
        <p>OneQuery</p>
        <div className="footer-links">
          {footerLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              onClick={() =>
                trackLandingCtaClick(
                  `footer_${link.label.toLowerCase()}`,
                  "footer",
                  link.href
                )
              }
            >
              {link.label}
            </a>
          ))}
          <FooterContactButton />
        </div>
      </footer>
    </div>
  );
}
