const bannedViMethods = new Set(["mock", "spyOn", "stubGlobal"]);
const DB_TEST_FIXTURE_MODULE = "@onequery/db/testing/setup";
const DB_FACTORY_NAMES = new Set(["createDb", "createDatabaseHandle"]);
const DB_FACTORY_RUNTIME_MODULES = new Set([
  "@onequery/db",
  "@onequery/db/server",
]);
const TYPESCRIPT_FILE_IMPORT_PATTERN = /\.(?:tsx?|mts|cts)(?:$|[?#])/;
const VITEST_MODULE = "vitest";
const VITEST_TEST_API_NAMES = new Set(["describe", "it", "test"]);

function readStringLiteralValue(node) {
  if (!node || node.type !== "Literal" || typeof node.value !== "string") {
    return null;
  }

  return node.value;
}

function readStaticPropertyName(node) {
  if (!node) {
    return null;
  }

  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }

  if (node.computed && node.property.type === "Literal") {
    return typeof node.property.value === "string" ? node.property.value : null;
  }

  return null;
}

function readImportSpecifierName(specifier) {
  if (specifier.type !== "ImportSpecifier") {
    return null;
  }

  if (specifier.imported.type === "Identifier") {
    return specifier.imported.name;
  }

  return readStringLiteralValue(specifier.imported);
}

function readLocalImportName(specifier) {
  if (!specifier.local || specifier.local.type !== "Identifier") {
    return null;
  }

  return specifier.local.name;
}

function readRootIdentifierName(node) {
  let current = node;

  while (current?.type === "CallExpression") {
    current = current.callee;
  }

  while (current?.type === "MemberExpression") {
    current = current.object;
    while (current?.type === "CallExpression") {
      current = current.callee;
    }
  }

  return current?.type === "Identifier" ? current.name : null;
}

function isDbFactoryRuntimeModule(specifier) {
  return (
    DB_FACTORY_RUNTIME_MODULES.has(specifier) ||
    specifier === "@/client" ||
    specifier.endsWith("/client")
  );
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

const noDbFixtureCreateDbRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow opening separate database handles in tests that use the PGlite transaction fixture.",
    },
    schema: [],
    messages: {
      bannedCall:
        "{{factory}}() bypasses @onequery/db/testing/setup transaction rollback. Use the injected { db } fixture value instead.",
      bannedImport:
        "{{factory}} is banned in tests that import @onequery/db/testing/setup. Use the injected { db } fixture value instead.",
    },
  },
  create(context) {
    let importsDbTestFixture = false;
    const bannedImportSpecifiers = [];
    const dbFactoryNamespaces = new Map();

    return {
      ImportDeclaration(node) {
        const source = readStringLiteralValue(node.source);
        if (!source) {
          return;
        }

        if (source === DB_TEST_FIXTURE_MODULE) {
          importsDbTestFixture = true;
        }

        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportNamespaceSpecifier" &&
            isDbFactoryRuntimeModule(source)
          ) {
            const localName = readLocalImportName(specifier);
            if (localName) {
              dbFactoryNamespaces.set(localName, source);
            }
            continue;
          }

          const importedName = readImportSpecifierName(specifier);
          if (!importedName || !DB_FACTORY_NAMES.has(importedName)) {
            continue;
          }

          bannedImportSpecifiers.push({
            factory: importedName,
            node: specifier,
          });
        }
      },
      CallExpression(node) {
        if (!importsDbTestFixture || node.callee.type !== "MemberExpression") {
          return;
        }

        const factory = readStaticPropertyName(node.callee);
        if (!factory || !DB_FACTORY_NAMES.has(factory)) {
          return;
        }

        if (node.callee.object.type !== "Identifier") {
          return;
        }

        if (!dbFactoryNamespaces.has(node.callee.object.name)) {
          return;
        }

        context.report({
          node,
          messageId: "bannedCall",
          data: { factory },
        });
      },
      "Program:exit"() {
        if (!importsDbTestFixture) {
          return;
        }

        for (const bannedImportSpecifier of bannedImportSpecifiers) {
          context.report({
            node: bannedImportSpecifier.node,
            messageId: "bannedImport",
            data: { factory: bannedImportSpecifier.factory },
          });
        }
      },
    };
  },
};

const noDbFixtureConcurrentRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Vitest concurrent tests in files that use the PGlite transaction fixture.",
    },
    schema: [],
    messages: {
      banned:
        "{{api}}.concurrent is banned with @onequery/db/testing/setup because those tests share a migrated PGlite file-scope database. Keep fixture-backed tests serial within the file.",
    },
  },
  create(context) {
    let importsDbTestFixture = false;
    const testApiNames = new Set();

    return {
      ImportDeclaration(node) {
        const source = readStringLiteralValue(node.source);
        if (!source) {
          return;
        }

        if (source === DB_TEST_FIXTURE_MODULE) {
          importsDbTestFixture = true;
        }

        if (source !== DB_TEST_FIXTURE_MODULE && source !== VITEST_MODULE) {
          return;
        }

        for (const specifier of node.specifiers) {
          const importedName = readImportSpecifierName(specifier);
          if (!importedName || !VITEST_TEST_API_NAMES.has(importedName)) {
            continue;
          }

          const localName = readLocalImportName(specifier);
          if (localName) {
            testApiNames.add(localName);
          }
        }
      },
      MemberExpression(node) {
        if (!importsDbTestFixture) {
          return;
        }

        if (readStaticPropertyName(node) !== "concurrent") {
          return;
        }

        const api = readRootIdentifierName(node.object);
        if (!api || !testApiNames.has(api)) {
          return;
        }

        context.report({
          node,
          messageId: "banned",
          data: { api },
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
    "no-db-fixture-concurrent": noDbFixtureConcurrentRule,
    "no-db-fixture-create-db": noDbFixtureCreateDbRule,
    "no-typescript-file-imports": noTypeScriptFileImportsRule,
    "no-vi-mock": noViMockRule,
  },
};

export default plugin;
