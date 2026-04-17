import { BRAND_ICON_PATHS } from "../brand-icon-paths";
import type { BrandIconName } from "../brand-icon-paths";

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

function BrandIcon({ name }: { name: BrandIconName }) {
  return (
    <svg
      className="brand-icon"
      viewBox="0 0 24 24"
      aria-label={name}
      role="img"
    >
      <path d={BRAND_ICON_PATHS[name]} fill="currentColor" />
    </svg>
  );
}

function ControlPlaneInputIcon({ kind }: { kind: ControlPlaneInput["kind"] }) {
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
                <BrandIcon key={icon} name={icon} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
