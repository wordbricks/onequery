import { ShieldIcon } from "../blog-icons";
import type { BlogPost } from "../blog-types";

export const howStartupsCanBuildAnInHouseDataAgentPost: BlogPost = {
  body: [
    "OpenAI's in-house data agent is a useful reference point for startups, but the lesson is not that every company should copy a large internal platform. The practical lesson is that a data agent needs a controlled execution layer, a shared understanding of company metrics, and a way to prove that its answers are getting better.",
    "For a startup, the right first version is a narrow, auditable workflow: find the relevant data, generate SQL with enough context, validate the query, execute it through a safe gateway, and return the answer with the assumptions and source query attached.",
  ],
  category: "Product",
  date: "Apr 28, 2026",
  description:
    "A practical startup playbook for turning an AI data agent from a risky demo into a safe, auditable workflow.",
  icon: ShieldIcon,
  imageSrc:
    "/images/blog/how-startups-can-build-an-in-house-data-agent-icon.png",
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
};
