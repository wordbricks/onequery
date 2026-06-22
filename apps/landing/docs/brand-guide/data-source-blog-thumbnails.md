# Data Source Blog Thumbnails

Use this pattern for blog posts that announce or explain a newly supported
connected data source, Source API provider, or integration.

The goal is to make each data source post feel consistent without turning the
image into a partner lockup or a feature diagram.

## Output

- Size: `1254 x 1254` PNG.
- Location: `apps/landing/src/assets/blog/<post-slug>-icon.png`.
- Reference it from the post frontmatter:
  - `coverImage.src`: `../../assets/blog/<post-slug>-icon.png`
  - `coverImage.alt`: `OneQuery logo connected to the <provider> logo with a heart symbol.`

## Composition

Use a single centered row:

1. OneQuery logo card.
2. Solid heart.
3. Provider logo card.

Do not add titles, subtitles, URLs, arrows, labels, dotted backgrounds, or
descriptive copy. The article title and description provide that context.

## Canvas

| Element | Value |
| --- | --- |
| Canvas | `1254 x 1254` |
| Background | `#f7f7f5` |
| Main row vertical center | `627px` |
| Empty outer padding | At least `250px` on each edge |
| Total composition width | About `830px` |

Keep the full composition inside the central three-fifths of the canvas. The
thumbnail should still read clearly when cropped into blog cards or social
previews.

## Logo Cards

Use equal cards so the OneQuery icon and provider mark have balanced visual
weight.

| Element | Value |
| --- | --- |
| Card size | `270 x 270` |
| Card fill | `#fbfbfa` |
| Card stroke | `#111111`, `1.5px` |
| Card radius | `42px` |
| Shadow | Very soft alpha-black only; avoid heavy elevation |
| Gap card to heart | `90px` |

### OneQuery Card

- Use `apps/landing/public/onequery-icon.png`.
- Center it in the left card.
- Render at about `162 x 162`.
- Do not use the OneQuery wordmark.
- Do not put partner marks inside the OneQuery icon.

### Provider Card

- Use the provider's official logo asset.
- Preserve its proportions.
- Prefer a black or monochrome version only when the provider's brand rules
  allow it.
- Center it in the right card.
- Fit it to about `196px` wide, adjusting down when the logo is unusually tall
  or dense.
- Do not redraw provider logos with an image generation model; generated logos
  drift from official marks.
- Do not recolor partner logos unless their brand rules allow it.

## Heart

Use one centered solid heart between the two cards.

| Element | Value |
| --- | --- |
| Heart box | About `122 x 122` |
| Fill | `#050505` |
| Shape | Symmetric, standard heart silhouette |

Avoid novelty hearts, lopsided hearts, hand-drawn hearts, and icons with
uneven bottom points. The heart should read as a neutral connector, not as a
new brand mark.

## Source Asset Rules

- Use official logo files when available.
- Keep temporary source logos outside the repo unless they will be reused.
- Commit only the final thumbnail unless the raw logo asset is already part of
  the landing asset system.
- If a provider only has a low-resolution image, get a better official asset
  before making the thumbnail.
- If the provider logo includes text as part of the mark, that is acceptable;
  do not add extra readable text around it.

## Workflow

1. Create or update the blog post under `apps/landing/src/content/blog/`.
2. Confirm the post slug and target thumbnail path.
3. Gather the OneQuery icon and official provider logo.
4. Compose the thumbnail using the geometry above.
5. Save the final PNG under `apps/landing/src/assets/blog/`.
6. Inspect the result with `view_image`.
7. Verify the dimensions with `file`.
8. Update the post frontmatter if needed.
9. Run `bun run --cwd apps/landing typecheck` when frontmatter or imports
   change.

## Checklist

- The final image is exactly `1254 x 1254`.
- Only two logo cards and one heart are visible.
- OneQuery and provider logos are official assets, not generated approximations.
- The cards are the same size and aligned to the same center line.
- The heart is centered between the cards and has a clean symmetric shape.
- There is no title, subtitle, URL, arrow, or caption inside the image.
- The final PNG is referenced by the blog post frontmatter.
