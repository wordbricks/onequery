# Tone of Voice

OneQuery helps developers connect their data stack, keep credentials under
control, and run human or agent queries through workflows they can inspect,
trust, and repeat.

Our voice should feel like the product itself: precise, calm, and useful. We do
not need to sound louder than the infrastructure we protect. We earn attention
by making complex systems feel legible, safe, and ready for real work.

When developers read OneQuery copy, they should feel that the product
understands the stakes of data access: credentials are sensitive, queries can be
expensive, and agents need clear boundaries before they touch production data.
Our language should reduce ambiguity. It should make every action, boundary,
and outcome easy to understand.

This guide is English-first. Product copy, examples, and voice principles should
be written in English unless a specific surface requires localization.

## Voice Principles

### Precise

We say exactly what OneQuery does. We name the source, action, state, and
result whenever that context helps the user make a decision.

Use concrete language over broad promises. Say "read-only query validation" or
"full query history" instead of "enterprise-grade safety." Say "the connector
runs in your infrastructure" instead of "secure by design" when that is the
actual reason to trust the system.

Precision does not mean over-explaining. The goal is to remove doubt, not to
display every implementation detail.

### Calm

OneQuery works in environments where people already have enough noise:
dashboards, incidents, billing surprises, permission requests, and fragile data
access paths. Our copy should be steady.

We do not use hype, fear, or urgency as a shortcut. We avoid language that makes
data work feel magical, chaotic, or risky for its own sake. Even when we talk
about safeguards, failures, retries, or audit trails, we keep the tone measured
and operational.

The product can be confident without sounding inflated.

### Accountable

Trust is built through visible behavior. OneQuery should speak in terms of
evidence: logs, histories, limits, validation, ownership, and explicit states.

When something succeeds, we say what completed. When something fails, we say
what happened, what remains unchanged, and what the user can do next. Failure is
not treated as an exception to the experience. It is a normal part of the
workflow, and our copy should make the next transition clear.

Accountable copy never hides behind vague reassurance.

### Practical

OneQuery is for developers trying to give teams and AI agents safe access to
data without scattering credentials or inventing one-off query paths. Our
language should respect their time.

We lead with the operational value: connect the source, validate the query,
bound the cost, keep the credential central, leave an audit trail. We avoid
ornamental storytelling when a direct sentence will do more useful work.

Practical does not mean cold. It means every line has a job.

## How We Sound

OneQuery should sound:

- Clear without being simplistic
- Technical without being dense
- Confident without being grandiose
- Direct without being abrupt
- Reliable without being corporate
- Quiet without being invisible

OneQuery should not sound:

- Magical
- Cute
- Alarmist
- Overly casual
- Abstractly enterprise
- Like a generic AI tool
- Ahead of the product

## Copy Rules

### Lead With the Real Action

Start from what the user can do or what the system has done.

Do:

> Connect Postgres, BigQuery, Athena, and product analytics tools behind one
> query interface.

Do not:

> Unlock the future of data access for modern teams.

### Make Safety Specific

Safety claims should point to the mechanism behind them.

Do:

> OneQuery validates read-only queries, enforces single-statement execution, and
> records query history for audit.

Do not:

> OneQuery makes your data completely safe.

### Respect Infrastructure Boundaries

When we describe self-hosting, connectors, or credentials, we should be exact
about where things run and what moves.

Do:

> The connector runs inside your infrastructure and returns results over
> outbound HTTPS.

Do not:

> Your data stays secure in the cloud.

### Use State-Based Language

OneQuery's product logic is explicit and workflow-driven. Our copy should make
states and transitions visible where they matter.

Do:

> Enrollment pending. The connector has not sent its first heartbeat yet.

Do not:

> Almost there. Something is happening in the background.

### Stay Within Current Capabilities

Only describe capabilities that OneQuery currently exposes or documents. Avoid
promising cloud, enterprise, NL to SQL, compliance, or future automation
behavior unless the specific surface is already available and named.

Do:

> Set query cost limits for BigQuery and Athena before execution.

Do not:

> Built for infinite scale and total governance.

### Make Agent Access Concrete

Agent-ready is core to OneQuery's voice, but it should be explained through the
same current safeguards we use for developers: approved sources, credential
boundaries, validation, limits, and audit history.

Do:

> Give agents a bounded query path to approved sources.

Do not:

> Let AI understand and operate your entire data stack.

## Product Messaging Themes

### Developer-Controlled Access

OneQuery brings databases, analytics tools, APIs, and operational sources into
one controlled query workflow. The message is not "replace your stack." The
message is "give developers and agents one governed access point."

Example:

> One query interface for the data tools your team already uses.

### Controlled Access

Credentials, permissions, and connector behavior should feel centralized and
inspectable. We should show that OneQuery reduces scattered access without
pretending access control is effortless.

Example:

> Keep credentials centralized while teams query approved sources from the CLI
> or web UI.

### Safe Execution

OneQuery should communicate safeguards as active product behavior: validation,
single-statement enforcement, cost limits, timeouts, bounded results, and audit
history.

Example:

> Validate the query before it runs. Bound the cost before it surprises you.
> Keep the record after it finishes.

### Agent-Ready Workflows

Agent-ready workflows are a core part of OneQuery's positioning. We should
still avoid presenting agents as magic. The stronger claim is controlled,
auditable access for both developers and agents, using the same source
boundaries and safeguards.

Example:

> Give agents a query path with the same limits, source boundaries, and audit
> trail your team expects.

## Microcopy Guidance

### Success

Success messages should confirm the completed transition and include the most
useful next fact.

Examples:

- `Source connected. You can now run read-only queries against warehouse.`
- `Query completed. 243 rows returned.`
- `Connector enrolled. Waiting for the first heartbeat.`
- `Agent query completed. The request used the warehouse source policy.`

### Failure

Failure messages should name the failed step, explain the stable state, and
offer a next action.

Examples:

- `Query blocked. OneQuery only allows a single read-only statement.`
- `Connector unavailable. The last heartbeat was 12 minutes ago.`
- `Cost limit exceeded. Raise the budget cap or narrow the query.`
- `Agent query blocked. This source does not allow that operation.`

### Empty States

Empty states should be quiet and useful. Avoid jokes or filler.

Examples:

- `No sources connected yet. Add a source to start running governed queries.`
- `No query history for this source. Completed queries will appear here.`
- `No agent activity yet. Agent queries will appear here after they run.`

### Calls to Action

CTAs should be compact and literal.

Good:

- `Connect source`
- `Run query`
- `Set cost limit`
- `View audit log`
- `Start gateway`
- `Approve agent access`

Avoid:

- `Get started now`
- `Unlock insights`
- `Make magic happen`
- `Supercharge your workflow`

## Before And After

| Before | After |
| --- | --- |
| Query your data with confidence. | Run read-only queries with validation, limits, and audit history. |
| Seamless data access for everyone. | Give each team one controlled path to approved data sources. |
| AI-powered insights in seconds. | Let agents query approved sources through bounded, auditable workflows. |
| Enterprise-grade security. | Keep credentials centralized and execute connector jobs inside your infrastructure. |
| Never worry about query costs again. | Set cost limits before BigQuery or Athena queries run. |
| Your AI data copilot. | Controlled query access for developers and agents. |

## Writing Checklist

Before publishing OneQuery copy, check that it:

- Names the real product action or user outcome
- Explains safety through a concrete mechanism
- Keeps infrastructure boundaries accurate
- Avoids hype, fear, and vague enterprise language
- Keeps agent-ready claims tied to current safeguards
- Avoids future product promises unless the capability is already documented
- Gives failures a clear next transition
- Sounds like a product proof, not a campaign slogan
