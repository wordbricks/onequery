export type RoadmapStatus = "shipped" | "next" | "later";

export type RoadmapItem = {
  key: string;
  title: string;
};

export type RoadmapLane = {
  eyebrow: string;
  items: ReadonlyArray<RoadmapItem>;
  status: RoadmapStatus;
  title: string;
};

export const ROADMAP_LANES = [
  {
    eyebrow: "Shipped",
    status: "shipped",
    title: "In production today",
    items: [
      {
        key: "read-only-query-validation",
        title: "Read-only query validation",
      },
      {
        key: "audit-log-for-every-query",
        title: "Audit log for every query",
      },
      {
        key: "organization-membership",
        title: "Organization & membership",
      },
      {
        key: "agent-entrypoints",
        title: "Claude Code, OpenClaw, Hermes",
      },
    ],
  },
  {
    eyebrow: "Next up",
    status: "next",
    title: "Production guardrails",
    items: [
      {
        key: "agent-profiles",
        title: "Agent profiles",
      },
      {
        key: "policy-templates",
        title: "Policy templates",
      },
      {
        key: "custom-connectors",
        title: "Custom connectors",
      },
    ],
  },
  {
    eyebrow: "Planned",
    status: "later",
    title: "Security operations",
    items: [
      {
        key: "1password",
        title: "1Password",
      },
      {
        key: "sso-saml",
        title: "SSO & SAML",
      },
      {
        key: "approval-workflow",
        title: "Approvals",
      },
    ],
  },
] satisfies ReadonlyArray<RoadmapLane>;
