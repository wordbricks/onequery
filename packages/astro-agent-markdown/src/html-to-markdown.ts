import type {
  Element,
  ElementContent,
  Literals,
  Nodes,
  Parents,
  Root,
  RootContent,
} from "hast";
import rehypeMinifyWhitespace from "rehype-minify-whitespace";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import type { Plugin } from "unified";

const SKIPPED_TAGS = new Set([
  "head",
  "noscript",
  "script",
  "style",
  "svg",
  "template",
]);

function isElement(node: Nodes): node is Element {
  return node.type === "element";
}

function isLiteral(node: Nodes): node is Literals {
  return "value" in node;
}

function hasChildren(node: Nodes): node is Parents {
  return "children" in node && Array.isArray(node.children);
}

function findFirstElement(node: Nodes, tagName: string): Element | undefined {
  if (isElement(node) && node.tagName === tagName) {
    return node;
  }

  if (!hasChildren(node)) {
    return undefined;
  }

  for (const child of node.children) {
    const match = findFirstElement(child, tagName);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function getTextContent(node: Nodes): string {
  if (isLiteral(node)) {
    return node.value;
  }

  if (!hasChildren(node)) {
    return "";
  }

  return node.children.map((child) => getTextContent(child)).join("");
}

function hasReadableLinkContent(element: Element) {
  return element.children.some((child) => {
    if (isElement(child) && child.tagName === "img") {
      return true;
    }

    return getTextContent(child).trim().length > 0;
  });
}

function pruneElementContent(node: ElementContent): ElementContent | undefined {
  if (isElement(node) && SKIPPED_TAGS.has(node.tagName)) {
    return undefined;
  }

  if (hasChildren(node)) {
    node.children = node.children
      .map((child) => pruneElementContent(child))
      .filter(isDefined);
  }

  if (
    isElement(node) &&
    node.tagName === "a" &&
    !hasReadableLinkContent(node)
  ) {
    return undefined;
  }

  return node;
}

function pruneRootContent(node: RootContent): RootContent | undefined {
  if (isElement(node) && SKIPPED_TAGS.has(node.tagName)) {
    return undefined;
  }

  if (isElement(node)) {
    node.children = node.children
      .map((child) => pruneElementContent(child))
      .filter(isDefined);
  }

  if (
    isElement(node) &&
    node.tagName === "a" &&
    !hasReadableLinkContent(node)
  ) {
    return undefined;
  }

  return node;
}

function pruneRootChildren(root: Root) {
  root.children = root.children
    .map((child) => pruneRootContent(child))
    .filter(isDefined);
}

const extractReadableBody: Plugin<[], Root> = () => (tree) => {
  const body = findFirstElement(tree, "main") ?? findFirstElement(tree, "body");

  if (body) {
    tree.children = [...body.children] as RootContent[];
  }

  pruneRootChildren(tree);
};

const htmlToMarkdownProcessor = unified()
  .use(rehypeParse)
  .use(extractReadableBody)
  .use(rehypeMinifyWhitespace)
  .use(rehypeRemark)
  .use(remarkGfm, {
    tableCellPadding: true,
    tablePipeAlign: false,
  })
  .use(remarkStringify, {
    bullet: "-",
    fences: true,
    listItemIndent: "one",
    resourceLink: true,
  });

function compactMarkdown(value: string) {
  const markdown = value
    .split("\n")
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());

      if (cells.length > 0 && cells.every((cell) => /^:?-+:?$/u.test(cell))) {
        return `| ${cells
          .map((cell) => {
            const leftAligned = cell.startsWith(":");
            const rightAligned = cell.endsWith(":");

            return `${leftAligned ? ":" : ""}---${rightAligned ? ":" : ""}`;
          })
          .join(" | ")} |`;
      }

      return line;
    })
    .join("\n");

  return `${markdown
    .replace(/[ \t]+\]\(/gu, "](")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()}\n`;
}

export function htmlToMarkdown(html: string) {
  return compactMarkdown(String(htmlToMarkdownProcessor.processSync(html)));
}
