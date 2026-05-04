# Color

OneQuery's color system is mostly the absence of color. The interface should
feel like a precise infrastructure surface: white canvas, near-black type,
alpha-black structure, and one compact brand mark.

The product should not feel warm, decorative, gradient-heavy, or campaign-like.
Color supports hierarchy and proof. It should not become the story.

<!-- Comment: apps/landing/DESIGN.md names a blue icon color (`#1f84d1` approximate), but the current shipped icon is near-black. This guide keeps the design guide's monochrome principles and updates the logo-specific palette to match the actual asset. -->

## Source Of Truth

This guide is based on:

- `apps/landing/DESIGN.md`
- `apps/landing/src/app/styles.css`
- `apps/landing-video/src/compositions/open-claw-demo/tokens.ts`
- `apps/landing/public/onequery-icon.png`

Use the implemented CSS tokens and shipped icon before introducing new color
values.

## Core Palette

| Role | Value | Usage |
| --- | --- | --- |
| Page White | `#ffffff` | Main page background, product frame surfaces, documentation pages |
| Core Ink | `#0a0a0a` | Primary text, headings, filled CTAs, black product UI details |
| Icon Tile Black | `#121212` approximate | Inside the OneQuery app icon only |
| Whale Mark | `#d8e0e7` approximate | Inside the OneQuery app icon only |
| Surface Muted | `rgba(0, 0, 0, 0.02)` | Very quiet section or product UI surface tint |
| Muted Text | `rgba(0, 0, 0, 0.62)` | Primary paragraph copy in the implemented landing page |
| Soft Text | `rgba(0, 0, 0, 0.45)` | Secondary links, metadata, low-emphasis descriptions |
| Faint Text | `rgba(0, 0, 0, 0.28)` | Very low-emphasis labels, video UI only |
| Line | `rgba(0, 0, 0, 0.12)` | Standard borders and dividers |
| Strong Line | `rgba(0, 0, 0, 0.18)` | Stronger borders where needed for clarity |
| Wash | `rgba(0, 0, 0, 0.05)` | Chip fills, quiet selected states |
| Strong Wash | `rgba(0, 0, 0, 0.07)` | Active chips, tracks, slightly stronger utility fills |

## Logo Palette

The logo palette is not a general UI palette. It belongs to the icon asset.

| Role | Value | Note |
| --- | --- | --- |
| Icon Tile Black | `#121212` | Dominant rounded-square tile color from the primary PNG |
| Icon Tile Edge | `#272727` / `#565656` | Internal edge and lighting values from the PNG |
| Whale Mark | `#d8e0e7` | Dominant whale silhouette color from the PNG |
| Whale Highlight | `#e8ecf0` | Small highlight and antialiasing values from the PNG |

Do not use these as arbitrary UI accents. If a surface needs brand presence, use
the icon itself rather than copying its colors into a background.

## Legacy Blue Note

`apps/landing/DESIGN.md` mentions **Brand Blue** (`#1f84d1` approximate) for an
earlier blue whale icon direction. The current shipped icon is not blue.

Until the icon asset changes:

- Do not use `#1f84d1` as a primary brand color.
- Do not recolor the black icon to blue.
- Do not introduce blue buttons, blue section backgrounds, or blue generic
  accents to satisfy old icon guidance.
- Keep blue only if it appears in third-party product UI, code examples,
  charts that require additional series colors, or a future approved asset.

## Interface Tokens

Use these values for web and marketing UI:

```css
:root {
  --page-bg: #ffffff;
  --surface: #ffffff;
  --surface-muted: rgba(0, 0, 0, 0.02);
  --ink: #0a0a0a;
  --text-muted: rgba(0, 0, 0, 0.62);
  --text-soft: rgba(0, 0, 0, 0.45);
  --line: rgba(0, 0, 0, 0.12);
  --line-strong: rgba(0, 0, 0, 0.18);
  --wash: rgba(0, 0, 0, 0.05);
  --wash-strong: rgba(0, 0, 0, 0.07);
  --shadow: 0 40px 80px rgba(0, 0, 0, 0.08);
  --shadow-ring: 0 0 0 1px rgba(0, 0, 0, 0.06);
}
```

For video and demo compositions, slightly softer text values are acceptable:

```ts
const surfaceTokens = {
  ink: "#0a0a0a",
  textMuted: "rgba(0, 0, 0, 0.56)",
  textSoft: "rgba(0, 0, 0, 0.40)",
  textFaint: "rgba(0, 0, 0, 0.28)",
  line: "rgba(0, 0, 0, 0.10)",
  lineSoft: "rgba(0, 0, 0, 0.06)",
  wash: "rgba(0, 0, 0, 0.05)",
  barTrack: "rgba(0, 0, 0, 0.07)",
};
```

## Semantic Color

Semantic colors should stay restrained and contextual. They are useful in
product UI, status messaging, and demos, but they should not redefine the brand.

| Role | Value | Usage |
| --- | --- | --- |
| Success Background | `rgba(22, 163, 74, 0.12)` | Successful task or query state in demo UI |
| Success Text | `#15803d` | Success labels with enough contrast |
| Terminal Background | `#0b0b0c` | Code or terminal preview surfaces |
| Terminal Text | `#f4f4f5` | Terminal foreground text |
| Terminal Muted | `rgba(255, 255, 255, 0.58)` | Terminal secondary text |
| Terminal Soft | `rgba(255, 255, 255, 0.32)` | Terminal prompts and faint metadata |

Use additional semantic colors only when the product state requires them:
error, warning, pending, blocked, or disabled. Prefer established design-system
tokens from the app surface instead of inventing new marketing colors.

## Color Proportions

For marketing pages and brand documents:

- 80-90% white or near-white surface
- 8-18% near-black text, lines, and UI structure
- 1-2% brand mark or semantic color

For product screenshots:

- Let the product UI remain recognizable.
- Keep surrounding frames white and neutral.
- Avoid recoloring screenshots to match a decorative palette.

For agent and AI messaging:

- Do not introduce a separate "AI purple" or glow system.
- Use the same monochrome OneQuery system.
- Show agent-readiness through bounded workflows, not color effects.

## Accessibility

- Body text should meet WCAG AA contrast against its background.
- Never use color alone to communicate state.
- Pair status color with text, icons, labels, or shape.
- Do not put muted text over imagery, gradients, or busy screenshots.
- Product diagrams and charts must use labels, not only color series.
- Favor `Core Ink` on `Page White` for critical claims and actions.

## Do

- Use white as the default page and document background.
- Use `#0a0a0a` for primary type and compact filled CTAs.
- Use alpha-black values for borders, chips, dividers, and muted copy.
- Keep shadows broad and low-opacity.
- Use the actual icon asset for brand color presence.
- Keep semantic colors local to product state.

## Don't

- Do not turn OneQuery into a blue, purple, beige, or gradient-led brand.
- Do not spread icon colors into generic UI controls.
- Do not use tinted section bands as the main page structure.
- Do not use color when spacing, type scale, or borders can create hierarchy.
- Do not create separate AI colors unless a future approved sub-brand requires
  them.
- Do not use low-contrast muted copy for critical product claims.

## Migration Notes

If the OneQuery icon changes back to a blue tile, update this file and
`logo.md` together:

- Replace `Icon Tile Black` with the new approved tile color.
- Decide whether the new color is logo-only or a general accent.
- Regenerate favicon and app icon exports.
- Update `apps/landing/DESIGN.md` so the design guide and shipped asset agree.
