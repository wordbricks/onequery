const bannedViMethods = new Set(["mock", "spyOn", "stubGlobal"]);

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

const plugin = {
  meta: {
    name: "onequery",
  },
  rules: {
    "no-vi-mock": noViMockRule,
  },
};

export default plugin;
