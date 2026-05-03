---
name: onequery-blog-images
description: >-
  Generate or replace OneQuery blog thumbnail images and article diagram images
  for apps/landing. Use when Codex needs to create blog list thumbnails, social
  share thumbnails, in-article architecture diagrams, update blog imageSrc
  references, follow the OneQuery diagram design system, or use the bundled
  assets/diagram-design-system.png visual reference.
---

# OneQuery Blog Images

Create OneQuery blog thumbnails and article diagrams that match the existing landing-site image system.

## Core Workflow

1. Inspect the target post under `apps/landing/src/landing/blog/posts/` and the current image references.
2. Read `references/onequery-blog-image-system.md` before generating.
3. Use the built-in `image_gen` flow from the `imagegen` skill for generation.
4. Inspect the generated image with `view_image` before copying it into the repo.
5. Copy the selected generated image from `$CODEX_HOME/generated_images/...` into `apps/landing/public/images/blog/`.
6. Update the consuming post:
   - Thumbnail/social image: set `imageSrc` to `/images/blog/<file>.png`.
   - Section diagram: add `imageSrc`, `imageAlt`, `imagePlacement`, `images`, or `inlineImages` on the relevant section.
7. Validate references with `rg`, verify dimensions with `file`, and run `bunx turbo typecheck --json --filter @onequery/landing` after TypeScript changes.

## Hard Rules

- Do not leave project-referenced images only under `$CODEX_HOME/generated_images`.
- Do not overwrite existing image assets unless the user asked to replace them.
- Keep thumbnail diagrams simple and centered with at least 1/5 canvas width empty on every edge.
- Avoid readable text in thumbnails. Use icons, arrows, dots, tiles, and abstract diagram components instead.
- For article diagrams, allow short uppercase module labels only when they improve clarity.
- Use `assets/diagram-design-system.png` as the visual reference. Do not use the old `diagram-system-reference.png` name.
- Do not use the filled app icon or OneQuery wordmark inside generated diagrams. Use the simplified line seal icon style when OneQuery is a diagram node.

## Naming

- Thumbnail/social share image: `<post-slug>-icon.png`.
- In-article diagram: `<post-slug>-<diagram-topic>.png`.
- Keep paths under `apps/landing/public/images/blog/`.
