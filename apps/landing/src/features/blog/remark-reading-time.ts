import { toString } from "mdast-util-to-string";
import getReadingTime from "reading-time";

type RemarkVFile = {
  data: {
    astro?: {
      frontmatter?: Record<string, unknown>;
    };
  };
};

export function remarkReadingTime() {
  return function transform(tree: unknown, file: RemarkVFile) {
    const textOnPage = toString(tree);
    const readingTime = getReadingTime(textOnPage);

    file.data.astro ??= {};
    file.data.astro.frontmatter ??= {};
    file.data.astro.frontmatter.readTime = readingTime.text;
  };
}
