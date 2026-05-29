type HtmlAttributeMap = Record<string, string>;

type HtmlElementNode = {
  attrs: HtmlAttributeMap;
  children: HtmlNode[];
  tagName: string;
  type: "element";
};

type HtmlNode =
  | HtmlElementNode
  | {
      text: string;
      type: "text";
    };

type RenderContext = {
  inline?: boolean;
  listDepth: number;
};

const BLOCK_TAGS = new Set([
  "article",
  "aside",
  "body",
  "div",
  "footer",
  "header",
  "main",
  "nav",
  "section",
]);
const SKIPPED_TAGS = new Set(["head", "script", "style", "svg", "template"]);
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function collapseWhitespace(value: string) {
  return value.replace(/\s+/gu, " ");
}

function compactMarkdown(value: string) {
  return value
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (match, entity) => {
    const normalizedEntity = String(entity).toLowerCase();

    if (normalizedEntity.startsWith("#x")) {
      const codePoint = Number.parseInt(normalizedEntity.slice(2), 16);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    if (normalizedEntity.startsWith("#")) {
      const codePoint = Number.parseInt(normalizedEntity.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    switch (normalizedEntity) {
      case "amp":
        return "&";
      case "apos":
        return "'";
      case "gt":
        return ">";
      case "lt":
        return "<";
      case "nbsp":
        return " ";
      case "quot":
        return '"';
      default:
        return match;
    }
  });
}

const MARKDOWN_TEXT_ESCAPE_CHARACTERS = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "-",
  ".",
  "!",
  "|",
]);

function escapeMarkdownText(value: string) {
  return Array.from(value, (character) =>
    MARKDOWN_TEXT_ESCAPE_CHARACTERS.has(character)
      ? `\\${character}`
      : character
  ).join("");
}

function escapeMarkdownTableCell(value: string) {
  return collapseWhitespace(value)
    .replace(/\\/gu, "\\\\")
    .replace(/\|/gu, "\\|")
    .trim();
}

function parseAttributes(rawAttributes: string): HtmlAttributeMap {
  const attrs: HtmlAttributeMap = {};
  const attributePattern =
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;

  for (const match of rawAttributes.matchAll(attributePattern)) {
    const [, rawName, doubleQuoted, singleQuoted, unquoted] = match;

    if (!rawName) {
      continue;
    }

    attrs[rawName.toLowerCase()] = decodeHtmlEntities(
      doubleQuoted ?? singleQuoted ?? unquoted ?? ""
    );
  }

  return attrs;
}

function parseTag(rawTag: string) {
  const isClosing = rawTag.startsWith("</");
  const isSelfClosing = rawTag.endsWith("/>");
  const content = rawTag
    .slice(isClosing ? 2 : 1, rawTag.length - (isSelfClosing ? 2 : 1))
    .trim();
  const [rawTagName = "", ...attributeParts] = content.split(/\s+/u);
  const tagName = rawTagName.toLowerCase();

  return {
    attrs: isClosing ? {} : parseAttributes(attributeParts.join(" ")),
    isClosing,
    isSelfClosing: isSelfClosing || VOID_TAGS.has(tagName),
    tagName,
  };
}

function appendChild(parent: HtmlElementNode, node: HtmlNode) {
  parent.children.push(node);
}

function parseHtml(html: string): HtmlElementNode {
  const root: HtmlElementNode = {
    attrs: {},
    children: [],
    tagName: "root",
    type: "element",
  };
  const stack: HtmlElementNode[] = [root];
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>/gu;
  let cursor = 0;

  for (const match of html.matchAll(tokenPattern)) {
    const token = match[0];
    const tokenIndex = match.index ?? 0;
    const text = html.slice(cursor, tokenIndex);

    if (text.length > 0) {
      appendChild(stack.at(-1) ?? root, {
        text: decodeHtmlEntities(text),
        type: "text",
      });
    }

    cursor = tokenIndex + token.length;

    if (token.startsWith("<!--") || token.startsWith("<!")) {
      continue;
    }

    const tag = parseTag(token);

    if (!tag.tagName) {
      continue;
    }

    if (tag.isClosing) {
      const matchingIndex = stack.findLastIndex(
        (node) => node.tagName === tag.tagName
      );

      if (matchingIndex > 0) {
        stack.length = matchingIndex;
      }

      continue;
    }

    const element: HtmlElementNode = {
      attrs: tag.attrs,
      children: [],
      tagName: tag.tagName,
      type: "element",
    };

    appendChild(stack.at(-1) ?? root, element);

    if (!tag.isSelfClosing) {
      stack.push(element);
    }
  }

  const trailingText = html.slice(cursor);
  if (trailingText.length > 0) {
    appendChild(stack.at(-1) ?? root, {
      text: decodeHtmlEntities(trailingText),
      type: "text",
    });
  }

  return root;
}

function findFirstElement(
  node: HtmlElementNode,
  tagName: string
): HtmlElementNode | undefined {
  if (node.tagName === tagName) {
    return node;
  }

  for (const child of node.children) {
    if (child.type !== "element") {
      continue;
    }

    const match = findFirstElement(child, tagName);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function renderChildren(nodes: readonly HtmlNode[], context: RenderContext) {
  return nodes.map((node) => renderNode(node, context)).join("");
}

function renderInlineChildren(node: HtmlElementNode, context: RenderContext) {
  return collapseWhitespace(
    renderChildren(node.children, { ...context, inline: true })
  ).trim();
}

function getTextContent(node: HtmlNode): string {
  if (node.type === "text") {
    return node.text;
  }

  return node.children.map(getTextContent).join("");
}

function renderList(node: HtmlElementNode, context: RenderContext) {
  let index = 1;
  const renderedItems = node.children
    .filter(
      (child): child is HtmlElementNode =>
        child.type === "element" && child.tagName === "li"
    )
    .map((item) => {
      const marker = node.tagName === "ol" ? `${index++}. ` : "- ";
      const indentation = "  ".repeat(context.listDepth);
      const rendered = compactMarkdown(
        renderChildren(item.children, {
          inline: true,
          listDepth: context.listDepth + 1,
        })
      );

      return rendered
        .split("\n")
        .map((line, lineIndex) =>
          lineIndex === 0
            ? `${indentation}${marker}${line}`
            : `${indentation}  ${line}`
        )
        .join("\n");
    });

  return renderedItems.length === 0
    ? ""
    : `\n\n${renderedItems.join("\n")}\n\n`;
}

function renderTable(node: HtmlElementNode) {
  const rows = node.children.flatMap((child) =>
    child.type === "element" &&
    ["thead", "tbody", "tfoot"].includes(child.tagName)
      ? child.children
      : [child]
  );
  const markdownRows = rows
    .filter(
      (child): child is HtmlElementNode =>
        child.type === "element" && child.tagName === "tr"
    )
    .map((row) =>
      row.children
        .filter(
          (cell): cell is HtmlElementNode =>
            cell.type === "element" && ["td", "th"].includes(cell.tagName)
        )
        .map((cell) => escapeMarkdownTableCell(getTextContent(cell)))
    )
    .filter((row) => row.length > 0);

  if (markdownRows.length === 0) {
    return "";
  }

  const [header = [], ...bodyRows] = markdownRows;
  const separator = header.map(() => "---");
  const formatRow = (row: readonly string[]) => `| ${row.join(" | ")} |`;

  return `\n\n${[formatRow(header), formatRow(separator), ...bodyRows.map(formatRow)].join("\n")}\n\n`;
}

function renderNode(node: HtmlNode, context: RenderContext): string {
  if (node.type === "text") {
    const text = collapseWhitespace(node.text);
    return context.inline ? text : text.trim();
  }

  if (SKIPPED_TAGS.has(node.tagName)) {
    return "";
  }

  if (/^h[1-6]$/u.test(node.tagName)) {
    const level = Number(node.tagName.slice(1));
    const text = renderInlineChildren(node, context);
    return text.length === 0 ? "" : `\n\n${"#".repeat(level)} ${text}\n\n`;
  }

  switch (node.tagName) {
    case "a": {
      const text = renderInlineChildren(node, context);
      const href = node.attrs.href;
      if (!href || text.length === 0) {
        return text;
      }
      return `[${text}](${href})`;
    }
    case "b":
    case "strong": {
      const text = renderInlineChildren(node, context);
      return text.length === 0 ? "" : `**${text}**`;
    }
    case "br":
      return "\n";
    case "code": {
      const text = renderInlineChildren(node, context);
      return context.inline ? `\`${text.replace(/`/gu, "\\`")}\`` : text;
    }
    case "em":
    case "i": {
      const text = renderInlineChildren(node, context);
      return text.length === 0 ? "" : `*${text}*`;
    }
    case "hr":
      return "\n\n---\n\n";
    case "img": {
      const alt = node.attrs.alt ?? "";
      const src = node.attrs.src ?? "";
      return src.length === 0
        ? escapeMarkdownText(alt)
        : `![${alt.replace(/\]/gu, "\\]")}](${src})`;
    }
    case "li":
      return renderInlineChildren(node, context);
    case "ol":
    case "ul":
      return renderList(node, context);
    case "p": {
      const text = renderInlineChildren(node, context);
      return text.length === 0 ? "" : `\n\n${text}\n\n`;
    }
    case "pre": {
      const text = getTextContent(node).trim();
      return text.length === 0 ? "" : `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
    }
    case "table":
      return renderTable(node);
    case "video": {
      const label =
        node.attrs["aria-label"] || node.attrs.title || "Embedded video";
      return `\n\n${label}\n\n`;
    }
    default:
      if (BLOCK_TAGS.has(node.tagName)) {
        return `\n\n${renderChildren(node.children, context)}\n\n`;
      }

      return renderChildren(node.children, context);
  }
}

export function htmlToMarkdown(html: string) {
  const parsedHtml = parseHtml(html);
  const body = findFirstElement(parsedHtml, "body") ?? parsedHtml;

  return `${compactMarkdown(renderChildren(body.children, { listDepth: 0 }))}\n`;
}
