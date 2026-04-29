import { FlaskIcon } from "../blog-icons";
import type { BlogPost } from "../blog-types";

export const usingLlmTelemetryToImprovePromptsWithGepaPost: BlogPost = {
  body: [
    "GEPA is most useful when the reflection step can see more than pass/fail labels. If a prompt optimizer can inspect the actual LLM trajectories behind failures, it can propose changes from evidence instead of guessing from aggregate scores.",
    "This use case shows how OneQuery can sit between a GEPA reflection agent and Laminar telemetry. The agent keeps the optimization loop small, OneQuery gives it a controlled way to query traces, and Laminar keeps the solve and review calls inspectable.",
  ],
  category: "Usecase",
  date: "Apr 30, 2026",
  description:
    "A practical workflow for using OneQuery to let a GEPA reflection agent inspect Laminar LLM telemetry while improving prompts.",
  icon: FlaskIcon,
  readTime: "9 min read",
  sections: [
    {
      id: "why-telemetry-matters",
      paragraphs: [
        "Prompt optimization often starts with a simple loop: run a program on examples, score the outputs, collect failures, and ask an LLM to rewrite the instruction. That works better than manual prompt editing, but it leaves useful evidence on the table.",
        "A wrong answer is rarely just a wrong final token. The useful signal is in the trajectory: which prompt was used, what reasoning the model wrote, whether the first solve call was already wrong, whether the review call caught the mistake, which examples were similar, and whether failures came from arithmetic, counting, formatting, or an unsupported shortcut.",
        "LLM telemetry systems such as Laminar capture that evidence. The question is how to let an optimization agent use it without handing the agent raw credentials, direct database access, or an unbounded query surface. That is where OneQuery fits.",
      ],
      title: "Why telemetry matters for GEPA",
    },
    {
      id: "the-experiment-shape",
      paragraphs: [
        "The experiment used an AIME-style math solver with two LLM calls per problem. The first call solved the problem and produced an initial answer. The second call reviewed the initial answer and produced the final answer. Both calls ran under the same Laminar trace so a single problem trajectory could be inspected as a parent span plus solve and review child spans.",
        "The GEPA loop optimized two DSPy predictors: solve.predict and review.predict. For each candidate prompt, GEPA evaluated examples, built a reflective dataset from successes and failures, and asked a reflection agent to propose an improved instruction.",
        "The important difference from a plain GEPA run was that the reflection agent had a OneQuery tool. Before proposing an instruction, it queried Laminar spans through OneQuery using the problem hash from the feedback. That let it inspect the exact solve and review telemetry for the examples GEPA was reflecting on.",
      ],
      title: "The experiment shape",
    },
    {
      id: "where-onequery-fits",
      paragraphs: [
        "OneQuery provided the controlled data access path. The reflection agent did not receive a Laminar API key or a direct warehouse connection. It received an org, a source key, and permission to request bounded read-only SQL through OneQuery.",
        "In the run, the Laminar source was exposed as a OneQuery source named laminar-aime-gepa. The agent queried the spans table with narrow filters on telemetry metadata such as oq_gepa_problem_hash and oq_gepa_stage. OneQuery handled source access, execution controls, row limits, and auditability.",
        "A typical query looked up the spans for one reflected problem: select span_id, name, trace_id, input, output, attributes from spans where attributes like a specific problem hash, ordered by start time and limited to a small number of rows. The result included the parent predict span plus the solve and review spans, including model outputs and metadata.",
      ],
      title: "Where OneQuery fits",
    },
    {
      id: "what-the-agent-saw",
      paragraphs: [
        "The Laminar spans made the failure mode visible. For a given problem, the agent could see whether the solve stage produced a plausible but unsupported answer, whether the review stage merely rubber-stamped it, or whether the review correctly identified an inconsistency.",
        "That distinction matters because the remedy is different. If solve is hallucinating a counting formula, the solve instruction needs stronger casework and verification. If solve is mostly right but review fails to catch arithmetic mistakes, the review instruction needs to behave more like an independent verifier.",
        "In one run, the reflection agent used OneQuery to inspect spans for a failed or partially successful trajectory, then proposed a review instruction that explicitly told the model not to restate the answer, to verify invariants and arithmetic, and to replace unsupported answers with a corrected conclusion.",
      ],
      title: "What the agent saw",
    },
    {
      id: "sample-setup",
      paragraphs: [
        "A meaningful run used 24 training examples, 12 validation examples, and 15 test examples, with max-metric-calls set to 72. Because each problem evaluation used a solve call and a review call, this represented more LLM calls than the metric budget alone suggests.",
        "The run disabled the DSPy cache so Laminar would receive fresh telemetry. It enabled the OneQuery reflection agent with the onequery-demo org and the laminar-aime-gepa source. It also wrote reflection transcripts so the team could inspect which SQL the agent requested and what telemetry came back.",
        "The relevant command shape was: run the tutorial in GEPA mode, set train, val, and test limits, set max-metric-calls, add no-cache, enable reflection-agent-onequery, pass the OneQuery org and Laminar source, and write result JSON, a markdown report, a progress plot, and reflection transcripts.",
      ],
      title: "A sample setup",
    },
    {
      id: "what-happened",
      paragraphs: [
        "In the larger run, the base prompt scored 3 out of 12 on the validation set. GEPA then generated candidate prompts using OneQuery-backed telemetry reflection. The first accepted solve candidate improved validation performance to 4 out of 12. A later solve candidate improved validation performance again to 5 out of 12.",
        "That is the key signal: the reflection agent was not just editing prompts from pass/fail labels. It queried Laminar spans through OneQuery, inspected the actual trajectories, and produced prompt changes that improved validation performance from 25 percent to about 42 percent.",
        "The final test score was still modest at 5 out of 15. That is expected for a small, noisy AIME-style experiment with limited optimization budget. The point of the use case is not that telemetry magically solves prompt optimization. The point is that telemetry gives the reflection loop a better substrate for diagnosis.",
      ],
      title: "What happened",
    },
    {
      id: "lessons-learned",
      paragraphs: [
        "The first lesson is that telemetry schema matters. The reflection agent initially made wrong assumptions about where metadata lived. Once the prompt included the actual Laminar schema, the agent reliably queried spans by attributes and received rows for the relevant trajectories.",
        "The second lesson is that solve and review should be separate. A single LLM call that both solves and reviews tends to blur the failure mode. Splitting the program into solve and review calls made it clear whether the initial answer was wrong or the verifier failed to catch it.",
        "The third lesson is that optimization needs auditability. The reflection transcripts showed the exact SQL the agent requested, whether OneQuery returned rows, which prompt candidate was proposed, and whether the candidate improved subsample and validation scores.",
      ],
      title: "Lessons learned",
    },
    {
      id: "why-this-is-a-good-onequery-use-case",
      paragraphs: [
        "This is a natural OneQuery use case because the agent needs real operational data, but it should not hold direct access to the telemetry system. OneQuery turns telemetry lookup into a controlled tool call with org-scoped access, bounded reads, and a record of what was queried.",
        "That pattern generalizes beyond Laminar and GEPA. Any prompt optimization, eval debugging, support triage, or agent repair loop can benefit from inspecting traces, product events, support tickets, warehouse rows, or observability data. The model should reason over the evidence, while OneQuery controls access to the evidence.",
        "The practical architecture is simple: instrument the LLM app, expose the telemetry source through OneQuery, give the optimizer a narrow query tool, and make every reflection step save its transcript. The result is a prompt improvement workflow that is more grounded, more auditable, and safer than giving an agent direct access to the telemetry backend.",
      ],
      title: "Why this is a good OneQuery use case",
    },
  ],
  slug: "using-llm-telemetry-to-improve-prompts-with-gepa",
  thumbnail: "blog-thumbnail-emerald",
  title: "Using LLM telemetry to improve prompts with GEPA",
};
