const bannedViMethods = new Set(["mock", "spyOn", "stubGlobal"]);
const TYPESCRIPT_FILE_IMPORT_PATTERN = /\.(?:tsx?|mts|cts)(?:$|[?#])/;

function readStringLiteralValue(node) {
  if (!node || node.type !== "Literal" || typeof node.value !== "string") {
    return null;
  }

  return node.value;
}

function reportTypeScriptFileImport(context, node, specifier) {
  if (!TYPESCRIPT_FILE_IMPORT_PATTERN.test(specifier)) {
    return;
  }

  context.report({
    node,
    messageId: "banned",
    data: { specifier },
  });
}

const noViMockRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow vi.mock(), vi.stubGlobal(), and vi.spyOn() in favor of dependency injection.",
    },
    schema: [],
    messages: {
      banned:
        "vi.{{method}}() is banned. Use constructor or parameter dependency injection instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") {
          return;
        }

        if (node.callee.computed) {
          return;
        }

        if (node.callee.object.type !== "Identifier") {
          return;
        }

        if (node.callee.object.name !== "vi") {
          return;
        }

        if (node.callee.property.type !== "Identifier") {
          return;
        }

        const method = node.callee.property.name;
        if (!bannedViMethods.has(method)) {
          return;
        }

        context.report({
          node,
          messageId: "banned",
          data: { method },
        });
      },
    };
  },
};

const noTypeScriptFileImportsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing TypeScript source files directly instead of using a package export.",
    },
    schema: [],
    messages: {
      banned:
        "Do not import '{{specifier}}' directly. Export that file from the owning package's public surface and import the exported subpath instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== "Identifier" ||
          node.callee.name !== "require" ||
          node.arguments.length === 0
        ) {
          return;
        }

        const specifier = readStringLiteralValue(node.arguments[0]);
        if (!specifier) {
          return;
        }

        reportTypeScriptFileImport(context, node.arguments[0], specifier);
      },
      ExportAllDeclaration(node) {
        const specifier = readStringLiteralValue(node.source);
        if (!specifier) {
          return;
        }

        reportTypeScriptFileImport(context, node.source, specifier);
      },
      ExportNamedDeclaration(node) {
        const specifier = readStringLiteralValue(node.source);
        if (!specifier) {
          return;
        }

        reportTypeScriptFileImport(context, node.source, specifier);
      },
      ImportDeclaration(node) {
        const specifier = readStringLiteralValue(node.source);
        if (!specifier) {
          return;
        }

        reportTypeScriptFileImport(context, node.source, specifier);
      },
      ImportExpression(node) {
        const specifier = readStringLiteralValue(node.source);
        if (!specifier) {
          return;
        }

        reportTypeScriptFileImport(context, node.source, specifier);
      },
    };
  },
};

const plugin = {
  meta: {
    name: "onequery",
  },
  rules: {
    "no-typescript-file-imports": noTypeScriptFileImportsRule,
    "no-vi-mock": noViMockRule,
  },
};

export default plugin;
