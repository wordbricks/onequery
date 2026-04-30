# Blog Diagram System

Use `diagram-system-reference.png` as the visual reference when creating new
OneQuery blog diagrams.

Use the `ONEQUERY ICON` sample in `diagram-system-reference.png` whenever a
diagram needs to represent OneQuery as a node, product, service, or actor. The
sample is a simplified line version of `apps/dashboard/public/onequery.svg` adapted to
the Diagram System.

## Visual Language

- White canvas with generous margins.
- Black sans-serif title in the top-left.
- Thin charcoal strokes for all containers, arrows, and dividers.
- Pale gray or translucent gray fills for modules and grouped containers.
- Subtle gray halftone dot texture inside emphasized groups.
- Rounded rectangles and pills with soft, restrained corners.
- Sparse uppercase monospace labels inside modules.
- Thin black arrows with small arrowheads.
- No logos, brand marks, watermarks, decorative blobs, 3D, or glossy effects,
  except the OneQuery line icon when OneQuery itself is a diagram subject.

## OneQuery Icon

- Reference: the `ONEQUERY ICON` sample in `diagram-system-reference.png`.
- Use as a simple charcoal stroke icon inside a pale gray rounded tile.
- Keep the icon unfilled except for the small eye dot.
- Use the same stroke weight as other diagram icons.
- Do not use the filled app icon in diagrams.
- Do not add the OneQuery wordmark unless the image explicitly needs a title or
  caption outside the diagram.

## Color Tokens

- Canvas: `#ffffff`
- Pale gray fill: `#f5f5f6`
- Cool gray fill: `#e5e7eb`
- Translucent group fill: `#f0f1f3`
- Stroke: `#1f1f1f`
- Text: `#000000`
- Texture: medium gray halftone dots at low opacity

## Prompt Template

```text
Create a minimal technical architecture diagram in the OneQuery blog diagram
system.

Canvas:
white background, generous margins, black bold title in the top-left, no logo.

Style:
thin charcoal outlines, pale gray translucent fills, rounded rectangles, subtle
gray halftone dot texture for grouped containers, sparse uppercase monospace
module labels, thin black arrows with small arrowheads, calm technical diagram
composition.

OneQuery:
when the diagram needs a OneQuery node, use the simplified line icon shown in
the `ONEQUERY ICON` sample inside a pale gray rounded tile.

Composition:
[Describe the nodes, groups, arrows, and hierarchy.]

Text:
Use short uppercase module labels. Keep captions tiny and minimal.

Avoid:
blue primary colors, colorful icons, logos, watermarks, photorealism, 3D,
glossy glass, heavy shadows, decorative blobs, dense dashboards, and long
paragraphs.
```
