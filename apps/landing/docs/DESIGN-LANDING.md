# Current Landing Structure

<!-- Note: the current apps/landing implementation is a colorful OneQuery CLI marketing page and diverges sharply from the newer OneQuery-inspired direction in DESIGN.md. -->

## Purpose

This document describes the **current** `apps/landing` implementation as it exists in code today. Use it as a structural reference when rebuilding the landing page, not as a recommendation to preserve the exact visuals.

Primary implementation files:
- [App.tsx](/Users/dev/git/onequery/apps/landing/src/App.tsx)
- [styles.css](/Users/dev/git/onequery/apps/landing/src/styles.css)
- [landing-config.ts](/Users/dev/git/onequery/apps/landing/src/landing-config.ts)

## 1. Page Shell

Top-level structure:

```tsx
div.page-shell
  header.site-header
    a.brand-tile
    nav.site-nav
      a INSTALL
      a WHAT IT DOES
      a HOW IT WORKS
      a SOURCE
    a.header-cta
  main.page-main
    section.hero-grid
    section.content-block.intro-block#surface
    section.content-block.two-column#install
    section.content-block.two-column#workflow
    section.cta-band
```

The page is a single static marketing page with hash-link navigation. There is no router state, no data fetching, and no server-rendered content. All marketing copy is hardcoded in `App.tsx`, except URLs and install snippets from `landing-config.ts`.

## 2. Header Structure

### `header.site-header`

Desktop layout:
- 3-column CSS grid
- Columns: `84px minmax(0, 1fr) 208px`
- Bordered outer shell using `--border`

Children:

1. `a.brand-tile`
- Links to `REPOSITORY_URL`
- Two-line stacked label:
  - `ONEQUERY`
  - `CLI`
- Functions as a logo tile rather than a conventional wordmark

2. `nav.site-nav`
- Horizontal auto-flow grid on desktop
- Contains three in-page hash links from `SECTION_IDS`
- Adds one external `SOURCE` link to `CLI_SOURCE_URL`

3. `a.header-cta`
- External link to GitHub repository
- Label: `GITHUB`

### Header Behavior

At `max-width: 1100px`:
- Header becomes 2 columns
- `header-cta` spans full width as a new row

At `max-width: 720px`:
- Header becomes 1 column
- Nav switches from horizontal flow to stacked vertical rows
- Each header child gets left and right borders

## 3. Main Section Order

The page has five content bands in this order:

1. Hero
2. Intro / capability cards
3. Install section
4. Workflow section
5. Closing CTA band

There is no footer in the current implementation.

## 4. Hero Section

### `section.hero-grid`

Desktop layout:
- 2 equal columns
- Minimum height: `560px`
- Bottom border present

Children:

1. `div.hero-copy`
- Blue background: `--blue` (`#29b6e1`)
- Right border divider
- Padding: `72px 78px`
- Contains:
  - `p.section-kicker`
  - `h1`
  - `p.hero-body`
  - `DownloadCommand`
  - `div.hero-actions`

2. `div.hero-art`
- Sand background: `--sand` (`#e7c2b8`)
- Decorative only, `aria-hidden="true"`
- Contains a stylized globe illustration built entirely in CSS

### Hero Copy Contents

Kicker:
- `OPEN-SOURCE CLI FOR SELF-HOSTED ONEQUERY`

Headline:
- `Query all your databases from one command line.`

Body:
- Explains local server, browser dashboard, connected databases, and quick install

Actions:
- `GET STARTED` links to `#install`
- `BROWSE REPOSITORY` links to GitHub

### `DownloadCommand`

Rendered as:

```tsx
div.download-command
  span.download-command-prompt
  code
  button.download-command-copy
```

Behavior:
- Copies the first `INSTALL_COMMANDS` command
- Shows `⧉` by default
- Temporarily changes to `COPIED`
- Resets after `COPY_FEEDBACK_RESET_DELAY_MS`

Visual treatment:
- Dark shell on blue hero
- Grid columns: `auto minmax(0,1fr) 36px`
- Rounded `14px`
- Monospace code line

### Hero Illustration

The right side is not an image. It is a CSS composition:

- `div.hero-globe`
- 4 continent blobs:
  - `.continent-a`
  - `.continent-b`
  - `.continent-c`
  - `.continent-d`
- 4 floating tags:
  - `.tag-a` = `serve`
  - `.tag-b` = `auth`
  - `.tag-c` = `query`
  - `.tag-d` = `state`

This is the most decorative part of the current landing page.

## 5. Intro Section

### `section.content-block.intro-block#surface`

Purpose:
- Explains the product surface area and core capabilities

Structure:

```tsx
section.content-block.intro-block#surface
  div.content-heading
    p.section-kicker
    h2
    p
  div.card-grid
    article.info-card * 3
```

Heading block:
- Kicker: `WHAT THIS CLI DOES`
- Heading: `A local server, a browser dashboard, and a terminal, all in sync.`
- Paragraph explaining server, login, data source connection, and queries

Card grid:
- 3 cards on desktop
- 1 column on narrower layouts
- Cards come from the local `cards` array in `App.tsx`

Current card content:

1. `RUN LOCALLY`
- `Start a server on your machine`

2. `LOG IN ONCE`
- `Authenticate and stay signed in`

3. `QUERY ANYTHING`
- `Run SQL across all your connected databases`

### Intro Styling

- Section padding: `80px 48px 56px`
- `content-heading` max width: `720px`
- `card-grid` starts with a top and left border
- Each `.info-card` adds right and bottom borders
- `h3` in cards is oversized at `34px`

This section visually feels like a poster/grid layout rather than a modern SaaS feature strip.

## 6. Install Section

### `section.content-block.two-column#install`

Purpose:
- Present install flow and quickstart commands

Structure:

```tsx
section.content-block.two-column#install
  article.text-panel
    p.section-kicker
    h2
    ol.timeline-list
  article.code-panel
    p.section-kicker
    pre
```

Left column:
- Kicker: `INSTALL AND BOOT`
- Heading: `Up and running in four steps.`
- Ordered list from local `timeline` array

Right column:
- Kicker: `QUICKSTART`
- Preformatted install snippet from `INSTALL_SNIPPET`

`INSTALL_SNIPPET` currently expands to:
- `npm install -g @onequery/cli`
- `onequery gateway`
- `onequery config set server http://127.0.0.1:5656`
- `onequery auth login`

### Install Styling

- 2-column grid on desktop
- `.text-panel` and `.code-panel` each have `min-height: 420px`
- Shared padding: `52px 48px`
- Right column background: `#f1ead9`
- Vertical divider between columns on desktop

## 7. Workflow Section

### `section.content-block.two-column#workflow`

Purpose:
- Show sample command usage and explain the explicit stateful flow

Structure:

```tsx
section.content-block.two-column#workflow
  article.code-panel.code-panel-dark
    p.section-kicker
    pre
  article.text-panel.text-panel-accent
    p.section-kicker
    h2
    p
    ul.explicit-list
    pre.workflow-inline
```

Left column:
- Kicker: `EXAMPLE QUERY`
- Uses local `querySnippet`
- Dark background

Right column:
- Kicker: `HOW IT WORKS`
- Heading: `Every step is visible. Errors are clear, never hidden.`
- Paragraph about visible system state and explicit errors
- Bullet list from `explicitItems`
- Inline workflow diagram from `workflowSnippet`

Current inline workflow snippet:

```text
connect source  -> ready
run query       -> results (or clear error)
session expires -> auto-refresh -> continue
```

### Workflow Styling

- Left panel background: `#15251e`
- Left panel text flips to white
- Right panel background: `#dff3d7`
- `workflow-inline` gets its own bordered translucent inset box

This section is the clearest expression of the project's explicit-state-machine mindset, even though the page itself is static.

## 8. Closing CTA Band

### `section.cta-band`

Purpose:
- Final reassurance and repeated install/source actions

Structure:

```tsx
section.cta-band
  div.cta-copy
    p.section-kicker
    h2
    p
  div.cta-actions
    a.action-link.action-link-dark
    a.action-link
```

Copy:
- Kicker: `OPEN SOURCE, RUNS ON YOUR MACHINE`
- Heading: `Your data stays local. Your queries stay yours.`
- Body reinforces local execution and no-cloud positioning

Actions:
- `INSTALL NOW` -> install script URL
- `READ CLI SOURCE` -> CLI source URL

Layout:
- 2-column grid with text on left and actions on right
- Collapses to 1 column at `max-width: 1100px`

## 9. Visual System

### Global Tokens

Defined in `:root`:

- `--paper: #f7f3ea`
- `--white: #fffdf8`
- `--ink: #111111`
- `--muted: #2c2c2c`
- `--line: #111111`
- `--blue: #29b6e1`
- `--sand: #e7c2b8`
- `--leaf: #6de15d`
- `--sun: #ffbf11`
- `--sea: #166fba`
- `--salmon: #ff5a30`
- `--border: 2px solid var(--line)`
- `--container: 1280px`

### Overall Look

The current landing is:
- High-contrast
- Flat-color driven
- Thick-outline based
- Playful and poster-like
- Much more colorful than the new OneQuery-inspired direction

Visual motifs:
- Thick `2px` black borders almost everywhere
- Cream paper background around an off-white inner page
- Bright blue and sand hero split
- Green, yellow, blue, and orange accent shapes
- Large bold sans type
- Minimal shadow usage

### Typography

Global font stack:
- `Arial, Helvetica, "Helvetica Neue", sans-serif`

Code font stack:
- `"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`

Headline treatment:
- `clamp(2.7rem, 5.5vw, 4.6rem)`
- `line-height: 0.96`
- `letter-spacing: -0.05em`

Card title treatment:
- `34px`
- `line-height: 1`
- `letter-spacing: -0.04em`

Small labels:
- `12px`
- `font-weight: 800`
- `letter-spacing: 0.08em`

## 10. Border and Layout Logic

The current page is built from a repeated framing pattern:

- Header has left and right outer borders
- Main page has left and right outer borders
- Every major section ends with a bottom border
- Many inner blocks use left/right/top borders to form visible panel divisions

This creates a printed-grid feel. The structure depends heavily on borders rather than shadows or subtle background separation.

## 11. Responsive Rules

### At `max-width: 1100px`

- Header drops from 3 columns to 2
- `header-cta` spans full width
- Hero becomes 1 column
- Two-column sections become 1 column
- CTA band becomes 1 column
- Hero copy swaps right border for bottom border
- Column divider becomes top divider
- Card grid becomes 1 column

### At `max-width: 720px`

- Header becomes 1 column
- Nav becomes vertically stacked
- Major paddings reduce to `36px 24px`
- Headline clamp changes to `clamp(2.2rem, 11vw, 3.4rem)`
- Download command becomes tighter
- Card titles shrink to `28px`
- Hero globe scales down
- Hero tags shrink in height and font size

### Reduced Motion

- `html { scroll-behavior: auto; }` under `prefers-reduced-motion: reduce`

## 12. Content Sources

Hardcoded local arrays in `App.tsx`:
- `navigationItems`
- `cards`
- `explicitItems`
- `timeline`
- `querySnippet`
- `workflowSnippet`

Config-driven constants in `landing-config.ts`:
- section IDs
- repository URL
- CLI source URL
- install script URL
- local server URL
- install command
- install snippet
- copy reset delay

There is no CMS, markdown loader, or external content source.

## 13. Rebuild Notes

If you reimplement `apps/landing`, the main structural decisions to revisit are:

1. Keep or replace the top-level section order.
2. Decide whether the heavy border-grid system survives.
3. Replace the decorative CSS globe if the new direction is more product-proof focused.
4. Decide whether the new page still needs:
   hero copy,
   feature summary section,
   install section,
   workflow section,
   repeated closing CTA.
5. Separate content structure from current visual treatment. The current information architecture is reusable even if the poster-like aesthetic is not.
