import type { ComponentType } from "react";

export type BlogCategory =
  | "All"
  | "Product"
  | "Engineering"
  | "Safety"
  | "Usecase"
  | "Research";

export interface BlogPost {
  body: string[];
  category: Exclude<BlogCategory, "All">;
  date: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  imageSrc?: string;
  readTime: string;
  sections?: BlogPostSection[];
  slug: string;
  thumbnail: string;
  title: string;
}

export interface BlogPostSection {
  id: string;
  paragraphs: string[];
  title: string;
}

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M4 6.5C4 4.57 7.58 3 12 3s8 1.57 8 3.5S16.42 10 12 10 4 8.43 4 6.5Zm0 0v5C4 13.43 7.58 15 12 15s8-1.57 8-3.5v-5M4 11.5v5C4 18.43 7.58 20 12 20s8-1.57 8-3.5v-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function FlaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M9 3h6M10 3v5.5l-4.7 8.15A3 3 0 0 0 7.9 21h8.2a3 3 0 0 0 2.6-4.35L14 8.5V3M8 15h8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function GitBranchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M6 4v12a4 4 0 0 0 4 4h2M18 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12-4v2a4 4 0 0 1-4 4h-2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function RouteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M5 6h3a4 4 0 0 1 0 8H6a3 3 0 0 0 0 6h13M5 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm14 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="m12 3 7 3v5.5c0 4.1-2.85 7.95-7 9.5-4.15-1.55-7-5.4-7-9.5V6l7-3Zm-3 9 2 2 4-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export const blogCategories: BlogCategory[] = [
  "Product",
  "Engineering",
  "Safety",
  "Usecase",
  "Research",
  "All",
];

export const blogPosts: BlogPost[] = [
  {
    body: [
      "OpenAI's in-house data agent is a useful reference point for startups, but the lesson is not that every company should copy a large internal platform. The practical lesson is that a data agent needs a controlled execution layer, a shared understanding of company metrics, and a way to prove that its answers are getting better.",
      "For a startup, the right first version is a narrow, auditable workflow: find the relevant data, generate SQL with enough context, validate the query, execute it through a safe gateway, and return the answer with the assumptions and source query attached.",
    ],
    category: "Product",
    date: "Apr 28, 2026",
    description:
      "A practical startup playbook for turning an AI data agent from a risky demo into a safe, auditable workflow.",
    icon: ShieldIcon,
    readTime: "8 min read",
    sections: [
      {
        id: "start-with-the-control-plane",
        paragraphs: [
          "The first question is not which model to use. The first question is what the agent is allowed to do. A useful data agent will eventually touch production databases, warehouses, product analytics, support systems, issue trackers, and customer records. That makes the execution layer the most important product surface.",
          "The minimum bar is read-only access, single-statement enforcement, query timeouts, cost limits for systems such as BigQuery and Athena, organization-level permissions, and an audit trail that records who asked the question, which SQL ran, which source was used, and what happened next.",
          "OneQuery can sit at this boundary. The agent can reason about the question and propose a query, while OneQuery manages credentials, validates safe execution, applies access policy, tracks cost, and keeps the run inspectable after the answer has been delivered.",
        ],
        title: "Start with the control plane",
      },
      {
        id: "make-company-context-retrievable",
        paragraphs: [
          "The agent needs more than schema names. It needs the operating context that analysts carry in their heads: which tables are trusted, which columns define customer identity, which events include internal users, how revenue is recognized, and which filters are required for a metric to mean what the team thinks it means.",
          "A startup does not need a perfect catalog on day one. Start with the top tables, the top metrics, common joins, known caveats, and a small library of canonical queries. The best seed set is usually the last month of questions people repeatedly asked in Slack, dashboards, notebooks, and support investigations.",
          "Once that context exists, OneQuery can become the shared place where source metadata, query history, and operational knowledge feed the agent instead of living as scattered tribal memory.",
        ],
        title: "Make company context retrievable",
      },
      {
        id: "keep-the-agent-loop-small",
        paragraphs: [
          'A broad promise like "answer anything about the business" creates a fragile agent. A better starting workflow is explicit: classify the question, retrieve metric and table context, draft SQL, run safety checks, execute through OneQuery, inspect the result shape, retry when the failure is understood, then return the answer with SQL and assumptions.',
          "This shape keeps failure normal. Missing permissions, ambiguous metrics, query budget limits, empty results, stale data, and syntax errors should be lifecycle states that the product can show and recover from. They should not disappear as exceptions inside an agent transcript.",
          "That is why deterministic workflow design matters for data agents. State transitions define what is true, reducers stay pure, and effects such as query execution are isolated behind async dispatch.",
        ],
        title: "Keep the agent loop small",
      },
      {
        id: "measure-it-with-golden-questions",
        paragraphs: [
          "A data agent cannot be judged by whether an answer sounds confident. It needs evaluations. The simplest useful eval set pairs a natural-language question with a human-reviewed SQL query and an expected result for a fixed data snapshot.",
          "The comparison should focus on behavior, not only SQL text. Two different queries can be equivalent, and two similar-looking queries can produce different answers because of joins, filters, deduplication, or time zones. Result comparison, SQL review, and regression tracking should all be part of the loop.",
          "OneQuery's audit history is useful raw material for this. Real user questions, successful queries, failed attempts, corrected queries, and repeated workflows can become the evaluation set that keeps model or prompt changes honest.",
        ],
        title: "Measure it with golden questions",
      },
      {
        id: "where-onequery-fits",
        paragraphs: [
          "The startup version of an in-house data agent is not a single chatbot. It is an agent paired with a data control plane. The model handles intent, planning, summarization, and repair. OneQuery handles the sensitive part: connections, credentials, permissions, budgets, safe query execution, and auditability.",
          "That division makes the product easier to trust. Teams can improve the agent's retrieval, prompts, memory, and evaluations without giving the model unchecked access to the data stack. They can also review the exact query path when an answer is wrong.",
          "The result is a realistic path from demo to daily use: connect a few important sources, define a small set of trusted metrics, run narrow investigation workflows, collect corrections, turn those corrections into memory and evals, then expand the agent's scope only where the workflow remains observable.",
        ],
        title: "Where OneQuery fits",
      },
    ],
    slug: "how-startups-can-build-an-in-house-data-agent",
    thumbnail: "blog-thumbnail-rose",
    title: "How startups can build an in-house data agent",
  },
  {
    body: [
      "Autonomous data work is easiest to reason about when the workflow state owns the truth. Source connection, access checks, budget gates, retries, and handoffs all become visible lifecycle transitions instead of scattered event handlers.",
      "That shape keeps reducers pure and makes side effects explicit. The result is a control plane that can explain what happened, why it happened, and what can safely happen next.",
    ],
    category: "Engineering",
    date: "Apr 28, 2026",
    description:
      "How OneQuery treats source connection, access, budgets, and retries as explicit lifecycle transitions.",
    icon: GitBranchIcon,
    readTime: "6 min read",
    slug: "designing-a-control-plane-for-autonomous-data-work",
    thumbnail: "blog-thumbnail-slate",
    title: "Designing a control plane for autonomous data work",
  },
  {
    body: [
      "Connector setup should be repeatable enough that the team stops treating it as custom project work. OneQuery pulls source configuration, validation, and team visibility into one consistent path.",
      "The goal is not to hide operational details. The goal is to put those details in a predictable place, with enough structure for teams to review and improve them over time.",
    ],
    category: "Product",
    date: "Apr 21, 2026",
    description:
      "Replacing one-off connector setup with a predictable path for every database and analytics source.",
    icon: DatabaseIcon,
    imageSrc: "/images/blog/making-data-source-setup-boring.png",
    readTime: "4 min read",
    slug: "making-data-source-setup-boring",
    thumbnail: "blog-thumbnail-emerald",
    title: "Making data source setup boring",
  },
  {
    body: [
      "Reliable data agents need more than a prompt and a connector. They need bounded capabilities, observable state, and lifecycle transitions that make failure and retry normal.",
      "Our research work focuses on the control surfaces around those agents: permissions, budgets, audit trails, and deterministic workflow execution.",
    ],
    category: "Research",
    date: "Apr 11, 2026",
    description:
      "What we are learning about deterministic workflow design for agent-assisted data operations.",
    icon: FlaskIcon,
    readTime: "8 min read",
    slug: "research-notes-on-reliable-data-agents",
    thumbnail: "blog-thumbnail-violet",
    title: "Research notes on reliable data agents",
  },
  {
    body: [
      "Safety in a connected data workspace starts with clear boundaries. Teams need to see which sources are connected, who can use them, and which actions require review.",
      "OneQuery models sensitive access as part of the workflow lifecycle so approvals, denials, and retries remain auditable instead of disappearing into application logs.",
    ],
    category: "Safety",
    date: "Apr 8, 2026",
    description:
      "A practical model for reviewing sensitive access without slowing down trusted data workflows.",
    icon: ShieldIcon,
    readTime: "5 min read",
    slug: "auditable-access-for-connected-teams",
    thumbnail: "blog-thumbnail-rose",
    title: "Auditable access for connected teams",
  },
  {
    body: [
      "Customer investigations often span warehouse records, product analytics, error traces, and issue history. The hard part is less about querying any one system and more about coordinating across all of them.",
      "A shared workspace lets operations teams keep the investigation path visible, repeatable, and tied to the systems that produced the answer.",
    ],
    category: "Usecase",
    date: "Apr 2, 2026",
    description:
      "How an operations team can connect warehouse, product analytics, and issue data without custom glue code.",
    icon: RouteIcon,
    readTime: "6 min read",
    slug: "coordinating-customer-investigations-across-sources",
    thumbnail: "blog-thumbnail-teal",
    title: "Coordinating customer investigations across sources",
  },
  {
    body: [
      "A workflow that throws exceptions for normal lifecycle events is difficult to inspect and harder to recover. Failures, retries, and handoffs deserve first-class states.",
      "State machines make those edges explicit. They give the product a place to model what users should see and give the system a place to decide what can happen next.",
    ],
    category: "Engineering",
    date: "Mar 18, 2026",
    description:
      "Failure, retry, and handoff logic become easier to reason about when the workflow state owns the truth.",
    icon: GitBranchIcon,
    readTime: "7 min read",
    slug: "state-machines-for-dependable-data-workflows",
    thumbnail: "blog-thumbnail-indigo",
    title: "State machines for dependable data workflows",
  },
];

export const thumbnailCells = [
  "cell-1",
  "cell-2",
  "cell-3",
  "cell-4",
  "cell-5",
  "cell-6",
  "cell-7",
  "cell-8",
  "cell-9",
  "cell-10",
  "cell-11",
  "cell-12",
  "cell-13",
  "cell-14",
  "cell-15",
];

export function comparePostDates(left: BlogPost, right: BlogPost) {
  return Date.parse(right.date) - Date.parse(left.date);
}

export function getBlogPostBySlug(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}
