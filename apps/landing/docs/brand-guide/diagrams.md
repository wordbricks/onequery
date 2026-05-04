# Diagrams

OneQuery needs diagrams because the product is about boundaries: where
credentials live, where connectors run, how queries move, and how agent access
is governed.

Diagrams should make those boundaries obvious without becoming decorative.

## Diagram Principles

### State And Flow First

OneQuery workflows are explicit state machines. Diagrams should show states,
transitions, and ownership boundaries.

Use diagrams for:

- Connector architecture
- Query lifecycle
- Agent access path
- Self-host runtime
- Credential ownership
- Audit record creation

### Monochrome By Default

Use the same visual system as the rest of the brand:

- White background
- Near-black labels
- Alpha-black strokes
- Soft neutral fills
- One compact OneQuery icon when needed

Do not use color as the main organizing device. If color is necessary, pair it
with labels and keep it semantic.

### Labels Over Legends

Prefer direct labels on nodes and arrows. Use a legend only when repeated
symbols need interpretation.

## Diagram Types

### Architecture Diagram

Use for showing major system surfaces.

Typical nodes:

- Developer
- Agent
- CLI
- Web UI
- API Server
- Connector
- Customer infrastructure
- Data source
- Audit log

Rules:

- Group customer-owned infrastructure separately from OneQuery-owned surfaces.
- Show outbound connector communication when relevant.
- Do not imply credentials move into a hosted control plane unless that is the
  actual behavior.

### Query Lifecycle Diagram

Use for showing execution flow.

Recommended states:

1. Request received
2. Source policy resolved
3. Query validated
4. Cost or limit checked
5. Connector job dispatched
6. Result returned
7. Audit record written

Show blocked paths as normal transitions, not as broken or chaotic side paths.

### Agent Access Diagram

Use for AI and agent messaging.

Must show:

- Agent requester
- Approved source boundary
- Policy or limit
- Query execution path
- Audit history

Avoid:

- Agents directly touching databases
- Agent icons with unrestricted arrows
- "AI brain" metaphors
- Purple or glow-based systems

### State Machine Diagram

Use for workflows that include retries, polling, or failure states.

Rules:

- Draw states as labeled nodes.
- Draw transitions as labeled arrows.
- Draw effects outside reducer/state nodes.
- Show failure and retry as expected lifecycle transitions.

This matches the project's workflow principle: state transitions define truth,
reducers are pure, and effects are deferred.

## Visual Style

| Element | Treatment |
| --- | --- |
| Canvas | `#ffffff` |
| Text | `#0a0a0a` |
| Secondary text | `rgba(0, 0, 0, 0.45)` |
| Node fill | `#ffffff` or `rgba(0, 0, 0, 0.02)` |
| Node stroke | `rgba(0, 0, 0, 0.12)` |
| Arrow stroke | `rgba(0, 0, 0, 0.35)` |
| Group boundary | `rgba(0, 0, 0, 0.10)` dashed or solid |
| Active state | `rgba(0, 0, 0, 0.07)` fill plus label |
| Success | Text label plus restrained semantic green |
| Blocked/error | Text label plus restrained semantic red or warning color |

## Layout

- Use left-to-right flow for request and query paths.
- Use top-to-bottom flow for lifecycle or state-machine diagrams.
- Keep node counts small; split large systems into multiple diagrams.
- Align nodes to a grid.
- Use consistent spacing between levels.
- Avoid crossing arrows when possible.

## Copy In Diagrams

Labels should be short and operational:

- `Validate query`
- `Resolve source policy`
- `Dispatch connector job`
- `Return bounded result`
- `Write audit record`
- `Blocked: multi-statement query`

Avoid:

- `Magic happens`
- `AI understands data`
- `Secure layer`
- `Enterprise governance`

## Accessibility

Every diagram should include:

- A title
- Descriptive alt text
- Labels on all important nodes
- Labels on arrows when direction matters
- A text summary near the diagram

The diagram must remain understandable in grayscale.

## Do

- Show ownership boundaries.
- Show states and transitions.
- Show blocked paths as normal behavior.
- Keep the OneQuery icon small and central only when helpful.
- Use labels instead of decorative color.

## Don't

- Do not draw agents with direct database access.
- Do not use cloud-like abstract infrastructure blobs.
- Do not overuse color-coded nodes.
- Do not make diagrams look like generic startup illustrations.
- Do not hide the connector boundary.
