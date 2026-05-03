# OneQuery Blog Image System

Use this reference after the `onequery-blog-images` skill triggers.

## Project Paths

- Blog post definitions: `apps/landing/src/landing/blog/posts/*.ts`
- Blog image assets: `apps/landing/public/images/blog/`
- Diagram visual reference: `assets/diagram-design-system.png` in this skill folder

## Thumbnail Prompt Requirements

Create a square `1254 x 1254` PNG for blog thumbnails and social share images.

Required constraints:

- Use a soft low-contrast pastel background.
- Keep at least 1/5 of the canvas width as empty padding on the top, right, bottom, and left.
- Fit the full diagram inside the central 3/5 by 3/5 area.
- Use one simple icon-first metaphor.
- Build from simple components only: outlined tiles, pills, arrows, dots, lines, and small abstract icons.
- Prefer 2 to 4 outlined icon tiles, one central rounded group, and clear arrow relationships.
- Avoid readable text, titles, headlines, module labels, logos, watermarks, 3D, glossy effects, dense dashboards, and complex workflows.

Suggested thumbnail prompt skeleton:

```text
Create a square 1:1 blog thumbnail using the OneQuery blog diagram system.

Article idea:
[ARTICLE IDEA]

Canvas:
soft pastel background, no logo, no wordmark, no watermark. Keep at least 1/5
of the canvas width as empty padding on the top, right, bottom, and left. The
full diagram must fit inside the central 3/5 by 3/5 area.

Style:
minimal technical architecture diagram, thin charcoal outlines, pale gray and
translucent gray fills, rounded rectangles and pills, subtle gray halftone dot
texture only inside grouped containers, thin black arrows with small arrowheads.

Composition:
[Describe 2 to 4 simple components and their arrows.]

Text:
No readable text. Use icons, abstract symbols, arrows, and containers only.

Avoid:
bright colors, logos, watermarks, photorealism, 3D, glossy glass, heavy
shadows, decorative blobs, dense dashboards, titles, labels, off-center
composition, and elements entering the outer 1/5 padding zone.
```

## Article Diagram Requirements

Article diagrams explain a section of a post, so they may be wider or more detailed than thumbnails while staying sparse.

Required constraints:

- Use the OneQuery diagram design system described in this reference.
- Use a white canvas with generous margins.
- Use thin charcoal strokes, pale gray fills, translucent grouped containers, small black arrows, and restrained rounded corners.
- Use short uppercase monospace labels only where useful.
- Avoid title text inside the image; the article section title already supplies context.
- If OneQuery appears as a node, use the simplified line seal icon style from the bundled `assets/diagram-design-system.png`, not a wordmark or filled app icon.

Suggested article diagram prompt skeleton:

```text
Create a minimal technical architecture diagram in the OneQuery blog diagram
system.

Canvas:
white background, generous margins, no title, no heading, no logo.

Style:
thin charcoal outlines, pale gray translucent fills, rounded rectangles, subtle
gray halftone dot texture for grouped containers, sparse uppercase monospace
module labels, thin black arrows with small arrowheads.

Composition:
[Describe nodes, groups, arrows, and hierarchy.]

Text:
Use short uppercase module labels only where needed. Do not add a title,
headline, or paragraph text.

Avoid:
blue primary colors, colorful icons, logos, watermarks, photorealism, 3D,
glossy glass, heavy shadows, decorative blobs, dense dashboards, titles,
headlines, and long paragraphs.
```

## Validation Checklist

- Open the final workspace image with `view_image`.
- Confirm the file is in `apps/landing/public/images/blog/`.
- Confirm thumbnails are square and `1254 x 1254` with `file`.
- Confirm no stale references remain with `rg`.
- For code reference changes, run `bunx turbo typecheck --json --filter @onequery/landing`.
