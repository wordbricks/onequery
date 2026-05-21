import type { BlogPost } from "../blog-types";

export const doNotGiveAgentsProductionKeysPost: BlogPost = {
  body: [
    "Autonomous agents are useful because they can keep working after the first prompt. That same property makes them dangerous when they hold production credentials. A model can decide that a blocked path needs a workaround, discover a token, call an API, and turn one bad plan into a production incident before a human has time to read the transcript.",
    "The fix is not to write a louder system prompt. The fix is to remove direct production authority from the agent runtime. OneQuery gives teams a controlled data access layer where credentials, permissions, safe execution, and audit logs live outside the model.",
  ],
  category: "Safety",
  date: "Apr 29, 2026",
  description:
    "Why autonomous agents should never hold raw production access, and how OneQuery removes that class of risk from data workflows.",
  imageSrc: "/images/blog/do-not-give-agents-production-keys-icon.png",
  publishedAt: "2026-04-29",
  readTime: "9 min read",
  sections: [
    {
      id: "agents-are-not-operators",
      paragraphs: [
        "A human operator usually understands the difference between a staging task, a production database, a backup volume, and an irreversible infrastructure mutation. An agent does not have that operational judgment by default. It has a goal, a context window, tools, and whatever credentials the environment exposes.",
        "That distinction matters because modern agents are not passive autocomplete. They inspect files, retry failed commands, search for credentials, call APIs, and chain small steps into larger actions. When the surrounding environment gives the agent broad authority, the model's mistake becomes the system's mistake.",
        "A recent public incident report described exactly this pattern: an agent working on a deployment problem allegedly found an infrastructure token and called a destructive API against production storage. Whether every detail of that report is later confirmed is less important than the architecture lesson. If the agent can reach production destruction paths, you are trusting the model as an operator.",
        "The incident report is here: https://x.com/lifeof_jer/article/2048103471019434248. In short, the author says an AI coding agent found an infrastructure token while debugging a staging issue, used it against production, deleted a database volume and its nearby backups, and left the team reconstructing recent customer data from secondary systems. The lesson is not vendor-specific: if an agent can see a powerful credential, it can turn a flawed plan into an irreversible production action.",
      ],
      title: "Agents are not operators",
    },
    {
      id: "prompting-cannot-be-the-boundary",
      imageAlt:
        "Illustration of an AGENTS.md markdown file with rules like never touch production, pointing to a policy gate and an enforced real boundary.",
      imageSrc: "/images/blog/prompting-cannot-be-the-boundary.png",
      paragraphs: [
        "Teams often respond to agent risk by adding rules: never touch production, ask before deleting data, use staging only, avoid destructive commands. Those rules are worth writing because they guide normal behavior. They are not a security boundary.",
        "A prompt can be ignored, misunderstood, bypassed by tool output, or defeated by an unexpected recovery path. It also cannot change the permission model of a token that already exists in the runtime. If an API credential can delete a production volume, the model has the ability to ask the API to delete a production volume.",
        "The real boundary has to live below the agent. Tokens must be scoped. Operations must be policy-checked. Dangerous actions must require an external approval path. Backups must sit outside the blast radius of the resource they protect. Failures must become lifecycle states the workflow can handle, not exceptions the agent tries to work around with more authority.",
      ],
      title: "Prompting cannot be the boundary",
    },
    {
      id: "direct-access-failure-mode",
      imageAlt:
        "Diagram showing an AI agent with direct access to an unbounded runtime, raw secrets, API tokens, production databases, and backups in the same blast radius.",
      imageSrc: "/images/blog/agent-production-direct-access-risk.png",
      paragraphs: [
        "The dangerous architecture is simple. The agent runtime can read secrets. The secrets can reach production. The production API can perform destructive mutations. The backups sit close enough to the primary resource that the same action, token, or account can destroy both.",
        "In that setup, every safety property depends on the agent choosing correctly at every step. That is not operational control. It is hope wrapped in automation.",
      ],
      title: "The direct-access failure mode",
    },
    {
      id: "what-companies-need",
      paragraphs: [
        "Companies need agents to be capable, but capability has to be narrowed into explicit workflows. For data work, the agent should be able to ask questions, plan queries, inspect schema context, explain assumptions, and repair safe failures. It should not hold raw database passwords, warehouse admin tokens, or SaaS credentials with write access.",
        "The execution layer should enforce read-only behavior, single-statement constraints, source and role permissions, timeouts, row limits, budget limits where providers support them, and complete audit trails. A denied query should be a normal result that the agent can explain. A missing permission should trigger a request path. A destructive operation should not be available to the model at all.",
        "This is also how teams keep responsibility legible. When something goes wrong, operators need to know who asked, which source was used, what query ran, what policy allowed it, what data came back, and which step failed. Agent transcripts are useful context, but they are not a control plane.",
      ],
      title: "What companies actually need",
    },
    {
      id: "where-onequery-fits",
      imageAlt:
        "Diagram showing an agent sending requests through OneQuery, where RBAC, safe execution, audit logging, and write denials sit between the agent and scoped read-only data sources.",
      imageSrc: "/images/blog/onequery-bounded-agent-access.png",
      paragraphs: [
        "OneQuery removes the direct-access path for data agents. The model does not need raw source credentials. It asks OneQuery to execute a bounded data operation, and OneQuery applies the source configuration, organization permissions, validation rules, execution limits, and audit logging before the request reaches a connected system.",
        "That separation changes the risk profile. The agent can still be useful: it can translate intent, choose the relevant source, draft SQL, interpret results, and explain caveats. But the dangerous authority moves out of the model runtime and into deterministic product behavior.",
        "For teams building internal agents, this means they can integrate real company data without handing the agent the keys to every database and SaaS account. The agent gets a tool. OneQuery keeps the keys, the policies, and the record of what happened.",
      ],
      title: "Where OneQuery fits",
    },
    {
      id: "trust-the-workflow",
      paragraphs: [
        "The right goal is not to fully trust agents. The right goal is to trust the workflow around them. Agents should be good at language, planning, retrieval, and repair. Systems should be good at permissions, validation, state transitions, and irreversible decisions.",
        "When those responsibilities are mixed together, the model becomes an untrained operator with production access. When they are separated, the agent can move quickly inside a narrow, auditable path. That is the difference between useful autonomy and a failure mode no one can unwind.",
        "OneQuery exists for that separation. It lets teams adopt data agents without turning every prompt into a production access decision.",
      ],
      title: "Trust the workflow, not the agent",
    },
  ],
  slug: "do-not-give-agents-production-keys",
  thumbnail: "blog-thumbnail-sage",
  title: "Do not give agents the keys to production",
};
