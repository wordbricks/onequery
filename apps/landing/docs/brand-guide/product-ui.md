# Product UI

Product UI is OneQuery's strongest brand proof. The brand should show real
interfaces, real states, and real infrastructure behavior instead of abstract
illustration.

Use product UI when explaining what OneQuery does, how it behaves, and why it
can be trusted by developers and agents.

## Principles

### Show Real Product Behavior

Screenshots and mockups should show concrete OneQuery states:

- Source connected
- Query validated
- Query blocked
- Cost limit set
- Connector heartbeat received
- Audit record created
- Agent query approved or denied

Avoid vague dashboards with empty graphs or generic "insights" panels.

### One Idea Per Frame

Each screenshot or UI frame should prove one claim. If the frame tries to show
setup, query execution, agent policy, and audit history at once, it becomes
noise.

### Product Before Decoration

The frame, shadow, and surrounding layout should support the product surface.
They should not compete with it.

## Screenshot Frames

Use the landing design system:

- Surface: `#ffffff`
- Border: `1px solid rgba(0, 0, 0, 0.12)`
- Radius: `14px`
- Shadow: `0 40px 80px rgba(0, 0, 0, 0.08)`
- Ring: `0 0 0 1px rgba(0, 0, 0, 0.06)`

Internal screenshot UI may use tighter radii and lower shadows. Do not place
cards inside decorative cards unless the inner card is actual product UI.

## Cropping

Crop around the workflow state that proves the claim.

Good crops:

- Query editor plus validation result
- Source list plus credential status
- Connector row plus heartbeat timestamp
- Audit log row plus requester/source/result
- Agent access policy plus approved sources

Avoid crops that:

- Hide the state label
- Cut off important controls
- Show too much empty navigation
- Rely on tiny text that will be unreadable in the final layout

## Data In Screenshots

Use realistic but safe sample data.

Good:

- `postgres://warehouse`
- `bigquery://analytics-prod`
- `postgres://customer-events`
- `read-only`
- `243 rows`
- `cost limit: $5.00`
- `last heartbeat: 12s ago`

Avoid:

- Real customer names
- Secrets or tokens
- Production hostnames
- Joke data
- Impossible metrics

## Agent UI

Agent-ready workflows are core to the brand, but they should look governed.

Show:

- The agent identity
- The approved source
- The policy or limit used
- The query status
- The audit record

Avoid:

- Glowing AI panels
- Purple gradients
- Autonomous "do anything" language
- Chat bubbles without source boundaries

## Product States To Show

| State | What To Show | Message |
| --- | --- | --- |
| Empty | Source setup prompt | Add a source before querying |
| Pending | Connector enrollment or heartbeat wait | The system is waiting for evidence |
| Active | Connected source with policy | Access is ready and bounded |
| Validating | Query safety check | Execution has a gate |
| Blocked | Reason and next step | Failure is a normal lifecycle state |
| Complete | Rows, source, requester, timestamp | The query produced evidence |
| Audited | Query history row | The record remains after execution |

## Composition

For marketing pages:

- Put the product frame below or beside the claim it proves.
- Keep surrounding copy short.
- Use white space, not color bands, to separate sections.
- Use product frames as the primary visual objects.

For docs:

- Keep screenshots functional and direct.
- Use captions to explain the state.
- Prefer focused screenshots over full-page captures.

For social images:

- Use one high-signal product frame.
- Keep text large enough to read on mobile.
- Do not make the logo larger than the proof.

## Do

- Use actual OneQuery surfaces where possible.
- Show real workflow states.
- Keep screenshots clean and readable.
- Use sample data that sounds operational.
- Preserve the monochrome interface system.

## Don't

- Do not use abstract SaaS dashboards as filler.
- Do not invent features in product UI.
- Do not blur the important state.
- Do not use decorative AI visuals.
- Do not overpack a screenshot with every feature.
