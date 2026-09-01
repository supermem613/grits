import { definePlugin, defineRule } from "@oxlint/plugins";

const MOCK_CALL_ORDER_MESSAGE =
  "Do not assert mock call order or call counts. Assert observable behavior.";
const PRIVATE_IMPORT_MESSAGE =
  "Do not import private internals from tests. Use the public interface.";
const VACUOUS_THROWS_MESSAGE =
  "Do not call assert.throws with no expected error. Name the error, regex, or predicate.";

const MOCK_CALL_PROPS = new Set(["calls", "callCount", "invocationCallOrder"]);
const MOCK_CALL_CALLEES = new Set([
  "toHaveBeenCalled",
  "toHaveBeenCalledTimes",
  "toHaveBeenCalledWith",
  "toHaveBeenNthCalledWith",
  "toHaveBeenLastCalledWith",
  "toHaveBeenOnceCalledWith",
]);

function identName(node: unknown): string | undefined {
  if (node && typeof node === "object" && "type" in node && node.type === "Identifier" && "name" in node) {
    return String(node.name);
  }
  return undefined;
}

function memberPropertyName(node: unknown): string | undefined {
  if (!node || typeof node !== "object" || !("type" in node) || node.type !== "MemberExpression") {
    return undefined;
  }
  const member = node as { computed?: boolean; property?: unknown };
  if (member.computed) {
    return undefined;
  }
  return identName(member.property);
}

function importSource(node: { source?: { value?: unknown } }): string | undefined {
  return typeof node.source?.value === "string" ? node.source.value : undefined;
}

function isPrivateSource(source: string): boolean {
  const slash = source.lastIndexOf("/");
  const backslash = source.lastIndexOf("\\");
  const base = source.slice(Math.max(slash, backslash) + 1);
  if (base.startsWith("_")) {
    return true;
  }
  return source.includes("/internal/") || source.includes("\\internal\\") || source.includes(".internal");
}

function importedName(specifier: unknown): string | undefined {
  if (!specifier || typeof specifier !== "object" || !("type" in specifier)) {
    return undefined;
  }
  if (specifier.type !== "ImportSpecifier") {
    return undefined;
  }
  const imported = (specifier as { imported?: unknown }).imported;
  return identName(imported);
}

// Flagged: mock.calls, mock.callCount, mock.invocationCallOrder, and toHaveBeenCalled* matchers.
// Accepted: assertions on observable results, including assert.equal.
// Boundary: computed members and mock objects not named mock are not detected.
const noMockCallOrder = defineRule({
  create(context) {
    return {
      MemberExpression(node) {
        const prop = memberPropertyName(node);
        if (prop === undefined || !MOCK_CALL_PROPS.has(prop)) {
          return;
        }
        const object = (node as { object?: unknown }).object;
        if (memberPropertyName(object) === "mock" || identName(object) === "mock") {
          context.report({ node, message: MOCK_CALL_ORDER_MESSAGE });
        }
      },
      CallExpression(node) {
        const callee = (node as { callee?: unknown }).callee;
        const name = memberPropertyName(callee) ?? identName(callee);
        if (name !== undefined && MOCK_CALL_CALLEES.has(name)) {
          context.report({ node, message: MOCK_CALL_ORDER_MESSAGE });
        }
      },
    };
  },
});

// Flagged: import paths whose basename starts with _, contains /internal/ or .internal, or imported names starting with _.
// Accepted: public named imports from public modules.
// Boundary: require() and import() are not detected.
const noPrivateTestImport = defineRule({
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = importSource(node);
        if (source !== undefined && isPrivateSource(source)) {
          context.report({ node, message: PRIVATE_IMPORT_MESSAGE });
          return;
        }
        const specifiers = (node as { specifiers?: unknown[] }).specifiers ?? [];
        for (const specifier of specifiers) {
          const name = importedName(specifier);
          if (name !== undefined && name.startsWith("_")) {
            context.report({ node, message: PRIVATE_IMPORT_MESSAGE });
            return;
          }
        }
      },
    };
  },
});

// Flagged: assert.throws(fn) with one argument.
// Accepted: assert.throws(fn, errorClass | regex | predicate | object).
// Boundary: a free imported throws() binding is not detected. This is a shape check. It cannot prove the matcher is specific.
const noVacuousThrows = defineRule({
  create(context) {
    return {
      CallExpression(node) {
        const args = (node as { arguments?: unknown[] }).arguments ?? [];
        if (args.length !== 1) {
          return;
        }
        const callee = (node as { callee?: unknown }).callee;
        if (memberPropertyName(callee) !== "throws") {
          return;
        }
        const object = (callee as { object?: unknown }).object;
        if (identName(object) !== "assert") {
          return;
        }
        context.report({ node, message: VACUOUS_THROWS_MESSAGE });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "grits-anti-slop" },
  rules: {
    "no-mock-call-order": noMockCallOrder,
    "no-private-test-import": noPrivateTestImport,
    "no-vacuous-throws": noVacuousThrows,
  },
});
