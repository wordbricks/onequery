# Typography

Typography carries most of OneQuery's visual identity. The system should feel
sharp, restrained, and product-native: one strong sans family, clear hierarchy,
compact UI labels, and code typography only where code is real.

## Source Of Truth

This guide is based on:

- `DESIGN.md`
- `src/styles/base.css`
- `../landing-video/src/compositions/open-claw-demo/tokens.ts`

## Font Families

### Primary Sans

Use `Geist` for brand, marketing, product UI, docs, labels, and navigation.

Fallback:

```css
font-family: "Geist", "Inter", ui-sans-serif, system-ui, sans-serif;
```

OneQuery should feel like one coherent operating surface. Do not introduce a
serif, editorial display face, or decorative brand typeface.

### Code And Terminal

Use a system mono or `JetBrains Mono` when the content is actually code,
terminal output, query text, or structured CLI output.

Fallback:

```css
font-family:
  "SFMono-Regular", ui-monospace, "Cascadia Code", "Source Code Pro", Menlo,
  Consolas, monospace;
```

For video compositions, `JetBrains Mono` is acceptable for terminal and command
surfaces.

## Type Scale

| Role | Size | Weight | Line Height | Letter Spacing | Usage |
| --- | ---: | ---: | ---: | ---: | --- |
| Hero Display | `72px` | `600` | `74px` | `-3.6px` | Primary landing headline |
| Hero Display Mobile | `36px` | `600` | `37px` | `-1.8px` | Mobile hero headline |
| Large Section | `60px` | `600` | `63px` | tight | High-emphasis section |
| Section Heading | `36px` | `600` | `40px` | `-1.8px` | Main section heading |
| Card Title | `24px` | `600` | `32px` | `-1.2px` | Product proof cards |
| Body Large | `18px` | `400` | `29px` | `0` | Hero subcopy and lead copy |
| Body | `16px` | `400` | `24px` | `0` | Standard copy |
| Nav / Link | `14px` | `400-500` | `20px` | `0` | Navigation and secondary links |
| Button | `13px` | `500` | `20px` | `0` | Compact CTAs |
| Meta | `11px` | `400-500` | `16px` | `0.02em` max | Eyebrows and metadata |
| Tiny Status | `10px` | `400` | `15px` | `0` | Small status pills |

## Hierarchy Rules

- Use size and spacing before color.
- Keep headings semibold, not heavy.
- Use negative tracking only for large headings.
- Keep body copy normal tracked for readability.
- Do not make compact UI text look like hero text.
- Do not use all caps except for short metadata labels.

## Headings

Headings should feel compressed and decisive. They should make the page feel
engineered, not editorial.

Good:

- `Controlled query access for developers and agents`
- `Credentials stay where they belong`
- `Every query leaves a record`

Avoid:

- `The future of data, unlocked`
- `Meet your new AI data companion`
- `A delightful way to explore everything`

## Body Copy

Body copy should be muted and useful. It should support the claim without
competing with product screenshots or diagrams.

Use:

- `rgba(0, 0, 0, 0.62)` for primary paragraphs in landing UI
- `rgba(0, 0, 0, 0.45)` for secondary copy, links, and metadata
- `#0a0a0a` for docs or dense reading surfaces where contrast matters

## Buttons And Labels

Button labels should be literal commands:

- `Connect source`
- `Run query`
- `View audit log`
- `Start gateway`
- `Approve agent access`

Avoid vague CTAs:

- `Get started now`
- `Unlock insights`
- `Supercharge workflow`
- `Make magic happen`

## Code Typography

Use mono type for:

- CLI commands
- SQL examples
- Environment variables
- File paths
- JSON snippets
- Terminal output

Do not use mono type as a decorative brand voice. It should indicate machine or
developer-facing content.

## Responsive Behavior

- Hero headline drops from `72px` desktop to about `36px` mobile.
- Body copy should not scale fluidly with viewport width.
- Preserve readable line lengths, ideally `55-75` characters for docs and
  marketing paragraphs.
- Avoid text wrapping that leaves a single technical token stranded unless the
  layout is constrained.

## Do

- Use `Geist` across brand and UI surfaces.
- Use one sans family for most communication.
- Let scale and whitespace create hierarchy.
- Use compact, literal button text.
- Keep metadata small and neutral.

## Don't

- Do not introduce serif-led editorial layouts.
- Do not use decorative display type.
- Do not overuse uppercase.
- Do not make body copy too low contrast in documentation.
- Do not use mono type for marketing personality.
