# Logo

OneQuery's logo system is intentionally restrained. The product should feel like
quiet infrastructure: precise, developer-first, and trustworthy enough to stay
out of the way. The logo is the one place where the brand becomes a compact
object.

<!-- Comment: DESIGN.md describes the mark as a blue rounded square, but the current shipped OneQuery asset is a black rounded square with a pale whale mark. This guide treats the shipped PNG as the source of truth until the asset changes. -->

## Source Of Truth

Use the shipped raster asset for the primary mark:

- Primary landing app icon: `src/assets/onequery-icon.png`
- Landing favicon and schema icon URL: `public/onequery-icon.png`
- Marketing video icon: `../landing-video/public/onequery-icon.png`
- OpenClaw variant: `public/onequery-openclaw-icon.png`
- Dashboard favicon: `../dashboard/public/favicon.ico`

Design-system exports live in `docs/brand-guide/design-system/assets/`:

- `apple-touch-icon.png`: 180x180 app icon for Apple touch surfaces
- `favicon.svg`: self-contained SVG favicon using the primary app icon
- `icon-192.png`: 192x192 app icon for web app manifests
- `icon-512.png`: 512x512 source-sized app icon for manifests and previews
- `logo.png`: 960x320 transparent horizontal lockup
- `logo.svg`: self-contained horizontal lockup with icon and `OneQuery` wordmark

The primary landing icon is a 512x512 PNG with an sRGB color profile and alpha
channel. It shows a pale whale silhouette on a near-black rounded square.

Do not redraw the whale, recreate it in CSS, trace it into a simplified SVG, or
replace it with a generic symbol. If a vector source becomes available, this
guide should be updated and the PNG should remain the rendered export.

## Logo Forms

### App Icon

The app icon is the compact OneQuery identity. Use it for:

- Favicons and app icons
- Header brand marks
- Small product UI moments where the brand is already named nearby
- Social preview thumbnails when the icon needs to anchor the composition

Render the icon as an image asset. Keep its built-in rounded square and internal
lighting intact.

### Wordmark Lockup

The default lockup pairs the app icon with the text `OneQuery`.

Use this lockup in:

- Website headers
- Documentation headers
- README hero areas
- Presentations and launch materials

Current landing usage:

- Icon: `30px` desktop, `32px` mobile
- Icon radius: `8px`
- Gap between icon and wordmark: `10-12px`
- Wordmark type: `Geist`, `20px`, `600`, near-black

The wordmark is text, not artwork. Write it exactly as `OneQuery` with capital
`O` and `Q`.

### Standalone Wordmark

Use the standalone `OneQuery` wordmark only when the icon would be redundant or
too small to render clearly, such as tight navigation, plain text attribution,
or copy-heavy documentation.

Do not create alternate capitalization such as `One Query`, `oneQuery`,
`onequery`, or `ONEQUERY` unless the surface is code, a package name, or a CLI
command where lowercase is required.

## Clear Space

Use the icon's rendered size as the unit `x`.

- Minimum clear space around the icon alone: `0.5x`
- Minimum clear space around the icon + wordmark lockup: `0.5x`
- Minimum clear space in crowded UI chrome: `8px`

Do not place badges, notification dots, partner marks, or decorative objects
inside the clear-space area.

## Minimum Sizes

| Use | Minimum Size | Preferred Size |
| --- | ---: | ---: |
| Favicon | `16px` | `32px` |
| Header icon | `24px` | `30-32px` |
| Product UI logo | `32px` | `48px` |
| Social/avatar use | `64px` | `128px+` |
| Presentation title slide | `48px` | `72px+` |

At sizes below `24px`, use only the app icon. Do not pair it with the wordmark
unless the text remains legible.

## Color Use

The icon should be used as-is. Its colors belong to the asset, not to the
general interface palette.

Approximate colors observed in the primary PNG:

- Icon tile: `#121212`
- Whale mark: `#d8e0e7`
- Edge/lighting grays: `#272727`, `#565656`, `#e8ecf0`

Do not sample the icon colors into generic buttons, panels, charts, or
decorative backgrounds. OneQuery's interface remains mostly white, near-black,
and alpha-black.

## Backgrounds

Preferred backgrounds:

- Pure white page surfaces
- Neutral light gray only when required for contrast
- Near-black surfaces only when the page already has a dark product context

Avoid:

- Busy photography
- Abstract gradients
- Mesh, glow, or bokeh backgrounds
- Brand-blue panels behind the current black icon
- Low-contrast dark surfaces that merge with the icon tile

When the icon appears on a dark background, add enough spacing or a subtle
neutral container so the rounded square remains visible.

## Product And Partner Contexts

Use the OneQuery mark more prominently than partner marks. For integrations,
partner logos should appear as source identifiers, not as co-primary brand
objects.

Good:

- OneQuery lockup in the header, source icons inside a connector list
- OneQuery app icon in the center of a control-plane diagram, partner icons as
  smaller connected nodes

Avoid:

- Creating unofficial combined logos such as `OneQuery x GitHub`
- Placing partner marks inside the OneQuery icon tile
- Recoloring partner logos into the OneQuery icon palette unless the partner
  usage rules allow it

## Do

- Use `src/assets/onequery-icon.png` for the primary landing web mark.
- Pair the icon with the text `OneQuery` for most brand introductions.
- Keep the icon small and deliberate in navigation.
- Preserve the PNG's internal lighting, silhouette, and rounded tile.
- Use the icon as the only saturated or high-identity object in otherwise quiet
  layouts.

## Don't

- Do not redraw, stretch, skew, crop, rotate, or recolor the icon.
- Do not add shadows, gradients, outlines, or extra effects to the icon.
- Do not place the icon on busy or low-contrast backgrounds.
- Do not use the whale silhouette without its tile unless a separate approved
  asset is created.
- Do not spread old blue-icon guidance into the current black-icon system.
- Do not use the OpenClaw variant as the main OneQuery brand mark.

## Asset Requests

The current guide can support web usage, but a complete brand system still needs
source assets:

- Vector source for the app icon
- Transparent standalone whale mark, if approved
- Black, white, and monochrome logo variants
- Additional favicon exports for `16`, `32`, and `48px`
