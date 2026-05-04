# Iconography

OneQuery iconography should be functional, quiet, and consistent with the
developer-first product surface. Icons help people scan source types, workflow
states, and actions. They should not become decoration.

## Icon Categories

### Brand Icon

The OneQuery whale tile is a brand asset, not a generic UI icon.

Use it for:

- Favicons
- Header lockups
- Product identity moments
- Social and video identity

Do not use it as a status icon, bullet, decoration, or repeated pattern.

### Product Icons

Product icons identify actions and concepts:

- Source
- Query
- Connector
- Audit log
- Policy
- Cost limit
- Agent access
- Runtime

Use simple line icons that match the surrounding UI. In React surfaces, prefer
the icon library already used by the app or package rather than introducing a
new icon set.

### Provider Icons

Provider icons identify data sources and integrations:

- Postgres
- MySQL
- BigQuery
- Athena
- GitHub
- Linear
- Sentry
- Analytics tools

Use provider icons as source identifiers. They should not compete with the
OneQuery mark.

## Style

| Property | Guidance |
| --- | --- |
| Stroke | `1.5-2px`, consistent within a surface |
| Size | `16px`, `20px`, `24px`, or `32px` |
| Color | `#0a0a0a` or muted alpha-black |
| Fill | Avoid filled icons unless the provider mark requires it |
| Radius | Match UI surface radius, do not over-round |
| Alignment | Center icons optically, not only mathematically |

## Color

Use monochrome icons for OneQuery UI actions.

Provider icons may keep their official colors when the purpose is source
recognition, but do not let provider color become the page palette.

For status:

- Pair icon color with a text label.
- Do not rely on color alone.
- Keep semantic colors restrained and local.

## Agent Icons

Agent-related icons should feel operational, not magical.

Good concepts:

- Agent requester
- Policy
- Access boundary
- Audit trail
- Approval
- Blocked operation

Avoid:

- Sparkles
- Crystal balls
- Abstract AI brains
- Purple glow icons
- Mascot-style faces

## Sizes

| Context | Size |
| --- | ---: |
| Inline metadata | `14-16px` |
| Button icon | `16px` |
| Navigation icon | `18-20px` |
| Source/provider list | `20-24px` |
| Diagram node | `24-32px` |
| Brand icon in header | `30-32px` |
| Product proof focal icon | `40-48px` |

## Do

- Use icons to improve scanability.
- Keep action icons monochrome.
- Use provider icons only where source recognition matters.
- Pair status icons with labels.
- Keep the OneQuery whale tile reserved for brand identity.

## Don't

- Do not use icons as decoration.
- Do not mix multiple icon styles in one surface.
- Do not place provider logos inside the OneQuery logo.
- Do not use sparkles or generic AI iconography for agent workflows.
- Do not use the OneQuery icon as a repeating background pattern.
