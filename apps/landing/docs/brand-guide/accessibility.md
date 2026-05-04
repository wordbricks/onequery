# Accessibility

Accessibility is part of OneQuery's trust model. A product that governs data
access should also make its own information legible, navigable, and clear.

This guide applies to marketing, documentation, product screenshots, diagrams,
videos, social images, and generated brand assets.

## Core Requirements

- Text must meet WCAG AA contrast against its background.
- Do not use color alone to communicate state.
- Every meaningful image needs alt text or nearby equivalent text.
- Diagrams need labels, not only color or position.
- Interactive controls need visible focus states.
- Motion should be purposeful, limited, and reducible.
- Product screenshots should remain readable at the size where they are shown.

## Color And Contrast

Use high contrast for critical content:

- Primary text: `#0a0a0a` on `#ffffff`
- Primary CTA: `#ffffff` on `#0a0a0a`
- Documentation body text: prefer `#0a0a0a` or a sufficiently dark muted value

Use muted text only for supporting copy. Do not use muted text for:

- Error states
- Blocking states
- Pricing or cost limit information
- Security or credential warnings
- Primary CTAs
- Required form labels

## State Communication

Every product state should be represented by at least two signals.

Good:

- Color plus text label
- Icon plus label
- Badge plus state-specific copy
- Table status plus timestamp

Avoid:

- Red/green dots with no labels
- Color-coded source nodes with no legend
- Chart series with color only
- Disabled-looking controls without explanation

## Alt Text

Alt text should describe the purpose of the image, not every pixel.

Examples:

- `OneQuery logo`
- `Connector diagram showing outbound HTTPS from customer infrastructure to OneQuery`
- `Dashboard screenshot showing query history and source access controls`
- `CLI output showing a completed read-only query`

Use empty alt text only for decorative images:

```html
<img src="public/onequery-icon.png" alt="" aria-hidden="true" />
```

If the surrounding text already names the brand and the icon is decorative, hide
the icon from assistive technology.

## Diagrams

Every diagram should include:

- A title
- Named nodes
- Directional labels when flow matters
- A text description nearby
- A legend when more than one stroke, fill, or status style is used

Do not rely on color to distinguish source, connector, server, and agent roles.
Use labels and consistent shapes.

## Product Screenshots

Product screenshots are brand proof. They still need accessibility support.

- Provide a caption or nearby summary.
- Crop screenshots around one clear idea.
- Avoid tiny UI text when the screenshot is the main evidence.
- Do not blur or darken important UI details.
- Do not put essential marketing copy inside screenshots only.

## Motion

Motion should clarify sequence, state transition, or workflow progress.

Good motion:

- Shows a connector moving from pending to active
- Shows a query moving through validation and execution
- Reveals an audit record after a query completes

Avoid:

- Decorative looping glow
- Fast background motion
- Motion that suggests AI magic
- Motion that obscures product state

Respect reduced-motion preferences where the surface supports it.

## Writing For Accessibility

Use plain product language:

- Name the action.
- Name the state.
- Name the next step.

Good:

> Query blocked. OneQuery only allows a single read-only statement.

Avoid:

> Something went wrong.

## Checklist

Before publishing an asset or page:

- Critical text passes contrast requirements.
- All meaningful images have alt text or nearby equivalent text.
- Status is not communicated by color alone.
- Controls have clear labels and focus behavior.
- Diagrams can be understood in grayscale.
- Motion is purposeful and not required to understand the content.
- Product proof remains readable at intended sizes.
