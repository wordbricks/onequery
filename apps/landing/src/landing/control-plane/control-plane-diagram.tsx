import { IconRobot, IconUser } from "@tabler/icons-react";

import { BrandIcon } from "../content/brand-icons";
import type { BrandIconName } from "../content/brand-icons";

type ControlPlaneInput = {
  key: string;
  kind: "human" | "bot";
  label: string;
};

type ControlPlaneOutput = {
  icons: readonly BrandIconName[];
  key: string;
  label: string;
};

const controlPlaneInputs = [
  { key: "member-a", kind: "human", label: "Engineer" },
  { key: "member-b", kind: "human", label: "Analyst" },
  { key: "member-c", kind: "bot", label: "CI agent" },
  { key: "member-d", kind: "bot", label: "AI agent" },
] satisfies ReadonlyArray<ControlPlaneInput>;

const controlPlaneOutputs = [
  {
    icons: ["postgresql", "mysql", "mongodb"],
    key: "database",
    label: "Databases",
  },
  {
    icons: ["bigquery", "snowflake"],
    key: "analytics",
    label: "Analytics",
  },
  {
    icons: ["notion", "googledrive"],
    key: "documents",
    label: "Internal docs",
  },
  {
    icons: ["github", "linear"],
    key: "code",
    label: "Code",
  },
] satisfies ReadonlyArray<ControlPlaneOutput>;

const controlPlanePolicies = [
  "Safe query screening",
  "Budget control",
  "Audit log",
  "Permission control",
] as const;

function ControlPlaneInputIcon({ kind }: { kind: ControlPlaneInput["kind"] }) {
  const Icon = kind === "human" ? IconUser : IconRobot;

  return (
    <Icon
      aria-hidden="true"
      className="control-plane-member-icon"
      stroke={1.8}
    />
  );
}

export function ControlPlaneDiagram() {
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
                <BrandIcon key={icon} className="brand-icon" name={icon} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
