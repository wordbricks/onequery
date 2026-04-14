# Design System Inspired by Open Agents

<!-- Note: the live homepage currently reports the document title as "Dashboard", which appears inconsistent with the marketing landing content. -->

## 1. Visual Theme & Atmosphere

Open Agents is not warm, literary, or brand-decorative. It feels like an infrastructure product rendered with unusual restraint: mostly white, mostly black, very little color, and just enough polish to make the product demo feel credible. The page behaves like a product proof, not a brand campaign.

The dominant mood is "clean lab notebook meets deployment dashboard." The canvas is plain white (`#ffffff`), the main text is near-black (`#0a0a0a`), and most supporting surfaces are transparent or white with faint black alpha borders. Instead of trying to look futuristic, the site looks confident enough to stay quiet. The visual hierarchy comes from scale, spacing, and crisp screenshot framing rather than from color.

Typography does most of the branding work. The site uses `Geist`, a modern grotesk with tight tracking and strong large-size behavior. Headlines are oversized, semibold, and aggressively letter-spaced in the negative direction, which gives the page its sharp, compressed, product-launch feel. Supporting copy is lighter and deliberately faded with alpha black, so the screenshots and headlines remain dominant.

The product frames are the most expressive visual objects on the page. They use white cards with faint strokes, 14px rounding, and large blurred shadows (`0 40px 80px rgba(0,0,0,0.08)`) to create lift without looking ornamental. This makes the entire site feel like a polished operating surface: minimal, monochrome, and real.

**Key Characteristics:**
- White-first interface with near-black typography and almost no saturated brand color
- `Geist` grotesk used for everything: hero, UI, labels, footer
- Large semibold headlines with tight negative tracking
- Product UI screenshots as primary visual identity
- Alpha-black palette for text hierarchy, borders, pills, and overlays
- Rounded rectangles with soft, high-blur shadows instead of loud cards
- Strong editorial spacing, but expressed through engineering minimalism rather than warmth
- Clear "real product, real infra" tone throughout

## 2. Color Palette & Roles

### Primary
- **Core Ink** (`#0a0a0a`): Primary headline and interface text. Used for hero copy, section headings, iconography, and filled buttons.
- **Pure White** (`#ffffff`): Main page background, card surface, and high-contrast reversed text on dark CTAs.

### Secondary & Accent
- **Muted Ink 50** (`rgba(0, 0, 0, 0.5)` / `#00000080`): Default supporting paragraph copy, footer links, and secondary metadata.
- **Muted Ink 35** (`rgba(0, 0, 0, 0.35)` / `#00000059`): Lower-emphasis links like the hero's secondary text CTA.
- **Muted Ink 22** (`rgba(0, 0, 0, 0.22)` / `#00000038`): Breadcrumb dividers, tiny metadata labels, and subtle separators inside demo surfaces.

### Surface & Background
- **Page White** (`#ffffff`): Full-page background. The site does not rely on tinted section bands.
- **Card White** (`#ffffff`): Hero product frame and smaller screenshot surfaces.
- **Soft Wash** (`rgba(0, 0, 0, 0.07)` / `#00000012`): Selected chip backgrounds and low-contrast utility fills.
- **Pill Fill** (`rgba(0, 0, 0, 0.05)` / `#0000000d`): Status pill background such as `active`.

### Borders & Shadows
- **Soft Stroke** (`rgba(0, 0, 0, 0.12)` / `#0000001f`): Main product frame border and light separators.
- **Hairline Ring** (`rgba(0, 0, 0, 0.06)` / `#0000000f`): Extra 1px ring inside the hero frame shadow stack.
- **Lift Shadow** (`rgba(0, 0, 0, 0.08)`): Large ambient shadow for screenshots and elevated product surfaces.

### Semantic
- **Primary CTA Fill** (`#0a0a0a`): Filled buttons such as `Sign in with Vercel`.
- **Primary CTA Text** (`#ffffff`): Text and icon color inside filled CTAs.

### Gradient System
Open Agents is effectively gradient-free. Any sense of depth comes from white-on-white layering, alpha-black borders, and generous blur shadows. If gradients are used at all, they should stay imperceptible and never become the brand.

## 3. Typography Rules

### Font Family
- **Primary UI + Display**: `Geist`, fallback: `system-ui`, `sans-serif`
- **Code**: the site mostly shows product-rendered code UI rather than code-styled marketing type; use a clean system mono only when code is truly needed

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display / Hero | Geist | 72px | 600 | 74.16px | -3.6px | Primary landing statement |
| Display / Hero Mobile | Geist | 36px | 600 | 37.08px | -1.8px | Mobile hero scale observed at 390px viewport |
| Section Heading | Geist | 36px | 600 | 40px | -1.8px | Main narrative section titles |
| Large Section Heading | Geist | 60px | 600 | 63px | strong negative | "Infrastructure that ships." scale |
| Card Title | Geist | 24px | 600 | 32px | -1.2px | Infrastructure grid titles |
| Body Large | Geist | 18px | 400 | 29.25px | normal | Hero subcopy and major descriptions |
| Body Standard | Geist | 16px | 400 | 24px | normal | Standard copy and nav |
| Small Link | Geist | 14px | 400 | 20px | normal | Footer links and minor navigation |
| Button Label | Geist | 13px | 500 | 19.5px | normal | Filled CTAs |
| Meta Label | Geist | 11px | 400-500 | 16.5px | normal | Breadcrumbs, micro metadata |
| Tiny Status | Geist | 10px | 400 | 15px | normal | Small pills like `active` |

### Principles
- **One family, many duties**: unlike serif-led editorial systems, Open Agents trusts one sans family to do everything.
- **Large type as structure**: hierarchy is driven by size and tracking more than by weight changes.
- **Negative tracking is part of the brand**: headings feel compressed and decisive, not airy.
- **Muted body copy**: paragraphs are intentionally lower-contrast than headings so product frames stay visually dominant.
- **Small UI stays plain**: metadata is tiny, neutral, and never stylized into a decorative system.

## 4. Component Stylings

### Buttons

**Primary Filled CTA**
- Background: Core Ink (`#0a0a0a`)
- Text: Pure White (`#ffffff`)
- Padding: `8px 12px`
- Radius: `8px`
- Weight: `500`
- Used for the hero's main action and repeated trust CTA

**Secondary Text Action**
- Background: transparent
- Text: Muted Ink 35 (`rgba(0, 0, 0, 0.35)`)
- Decoration: no border, no fill, no underline
- Used as a quiet supporting action, not as an outlined button

**Utility Tabs / Chips**
- Default background: transparent
- Active background: Soft Wash (`rgba(0, 0, 0, 0.07)`)
- Radius: `10px`
- Padding: roughly `8px 10px`
- Used inside the hero screenshot to suggest state without stealing attention

### Cards & Containers
- Major product frame: white surface, `1px solid rgba(0,0,0,0.12)`, `14px` radius
- Shadow stack: `0 40px 80px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)`
- Internal layout is panelized with thin separators and lots of white space
- Avoid tinted cards unless the content is clearly a screenshot or tool state

### Inputs & Forms
- The marketing site does not feature prominent form styling beyond the auth CTA
- If forms are added, they should stay monochrome: white field, soft alpha-black border, near-black text, subtle focus ring
- Radius should stay between `8px` and `10px`, never pill-heavy unless it is clearly a chip

### Navigation
- Minimal top navigation with a lightweight wordmark and a small mode/theme control
- No heavy nav chrome, no sticky colored bar, no oversized CTA treatment
- Typography stays small and neutral; the hero owns the emphasis

### Image Treatment
- Product screenshots are central, not supplementary
- Frames are white with faint strokes and soft ambient shadow
- Internal screenshot UI uses the same monochrome language as the page
- Imagery is product-native UI, not illustration, photography, or abstract blobs

### Distinctive Components

**Hero Product Frame**
- Large centered demo surface under the hero copy
- White card with 14px radius and deep blur shadow
- The single strongest proof point on the page

**Alternating Feature Rows**
- Text block and screenshot block alternate left/right
- Layout stays airy, with large gutters and restrained copy length
- Each row explains one concrete infrastructure behavior

**Infrastructure Grid**
- Four equal cards in a bordered grid
- Uses thin dividers rather than separately floating cards
- Product categories are named plainly: `AI SDK`, `AI Gateway`, `Sandbox`, `Workflow SDK`

**Minimal Footer Grid**
- Small multi-column footer with muted links and restrained labels
- No dark inversion, no decorative lockup, no brand-over-brand repetition

## 5. Layout Principles

### Spacing System
- Base rhythm is effectively `8px`, but the page reads in larger jumps: `16`, `24`, `32`, `40`, `64`, `96`, `176`
- Hero top padding is large and deliberate: about `176px`
- Buttons are compact; sections are spacious
- Product frames get more outer margin than inner density

### Grid & Container
- Content appears capped around `1190-1200px`
- Hero copy sits above the main screenshot rather than beside it
- Feature area uses alternating two-column composition on desktop
- Infrastructure section shifts into a four-column grid with vertical dividers

### Whitespace Philosophy
- **Proof over decoration**: whitespace exists to isolate claims and give screenshots authority.
- **Large calm surfaces**: the site rarely packs multiple visual ideas into one band.
- **Short copy blocks**: text is concise, leaving room for UI proof instead of storytelling excess.

### Border Radius Scale
- `8px`: filled CTAs
- `10px`: utility chips and active pills
- `14px`: hero product frame and elevated screenshot containers
- Avoid oversized 24-32px rounding; this system is softer than sharp enterprise UI, but not playful

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat (Level 0) | White background, no border | Page canvas, plain text areas |
| Hairline (Level 1) | `1px` alpha-black stroke | Simple separators and frame edges |
| Ring + Shadow (Level 2) | `0 0 0 1px rgba(0,0,0,0.06)` | Elevated product cards |
| Ambient Lift (Level 3) | `0 40px 80px rgba(0,0,0,0.08)` | Hero screenshot and major demo surfaces |
| Utility Fill (Level 4) | `rgba(0,0,0,0.05-0.07)` background only | Active tabs, chips, status pills |

**Shadow Philosophy**: Open Agents uses shadow to imply real software floating over a white page, not to create soft consumer-app coziness. The blur is broad, but the opacity is low. Borders stay faint and the page avoids dark section inversions, so depth feels precise and technical.

### Decorative Depth
- There is almost no decorative depth system
- Depth belongs to product surfaces, not backgrounds
- If a new element is not product proof or a key CTA, it should probably stay flat

## 7. Do's and Don'ts

### Do
- Use white as the main background and let typography carry the brand
- Keep primary text near-black (`#0a0a0a`), not charcoal-gray or navy
- Use `Geist` with semibold display sizes and negative tracking for major headlines
- Treat screenshots as primary content, not filler
- Use alpha-black borders and fills instead of introducing a color palette
- Keep CTA styling compact and direct
- Let section spacing, not color bands, organize the page
- Prefer plain product nouns and verbs over conceptual marketing language

### Don't
- Don't import a warm editorial palette, serif typography, or illustrative style
- Don't add bright accent colors as pseudo-branding
- Don't rely on gradients, glows, or abstract mesh backgrounds
- Don't use thick borders or high-contrast card chrome
- Don't over-round cards or buttons into consumer-app softness
- Don't make every action a filled button
- Don't increase body copy contrast so far that it competes with headlines
- Don't turn the infra grid into detached floating cards unless the site direction changes

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | ~390px and below | Hero compresses to `36px`, CTAs stay side-by-side if space allows, sections stack vertically |
| Tablet | ~768px | Two-column rhythm begins to loosen; screenshots and text get more breathing room |
| Desktop | ~1200px | Full hero width, alternating feature rows, four-column infrastructure grid |

### Touch Targets
- Primary CTA remains comfortably tappable with `8px 12px` padding and compact footprint
- Small nav affordances remain visible but intentionally understated
- Chips and tabs should not shrink below practical touch size even when they look lightweight

### Collapsing Strategy
- Hero headline drops from `72px` to `36px`
- Feature rows collapse into stacked text-first then image blocks
- Infrastructure grid becomes a single-column list on narrow screens
- Footer columns stack cleanly without adding boxes or background fills

### Image Behavior
- Product frames keep their radius and shadow on mobile
- Screenshots scale proportionally and remain the focal proof element
- Internal UI details may become less legible at mobile sizes, but the frame silhouette should stay intact

## 9. Agent Prompt Guide

### Quick Color Reference
- Primary text: `Core Ink (#0a0a0a)`
- Page background: `Pure White (#ffffff)`
- Supporting copy: `Muted Ink 50 (rgba(0,0,0,0.5))`
- Secondary link: `Muted Ink 35 (rgba(0,0,0,0.35))`
- Frame border: `Soft Stroke (rgba(0,0,0,0.12))`
- Frame shadow ring: `Hairline Ring (rgba(0,0,0,0.06))`
- Active chip fill: `Soft Wash (rgba(0,0,0,0.07))`

### Example Component Prompts
- "Create a landing hero on pure white with a `72px` semibold `Geist` headline in `#0a0a0a`, `-3.6px` tracking, and an `18px` muted paragraph in `rgba(0,0,0,0.5)`."
- "Design a primary CTA with `#0a0a0a` background, white text, `8px 12px` padding, and `8px` radius. Keep it compact, not pill-like."
- "Build a product screenshot frame with white background, `1px solid rgba(0,0,0,0.12)`, `14px` radius, and shadow `0 40px 80px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)`."
- "Create a feature row with left-aligned heading at `36px` semibold `Geist`, muted body copy, and a right-side product screenshot. Keep the page monochrome."
- "Design a four-column infrastructure grid using dividers instead of floating cards. Each title should be `24px` semibold `Geist` with muted descriptive copy below."

### Iteration Guide
1. Start from type scale and spacing, not color.
2. Keep every new element inside the white/black/alpha-black system unless there is a strong product reason not to.
3. Ask whether the element is proof, structure, or action:
   proof should look like product UI,
   structure should stay nearly invisible,
   action should be compact and dark.
4. Use fewer visual ideas per section.
5. If a design decision feels "brand expressive," reduce it once more.
