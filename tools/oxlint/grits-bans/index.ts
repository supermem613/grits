import { definePlugin, defineRule } from "@oxlint/plugins";

const REALPATH_NATIVE_MESSAGE =
  "fs.realpathSync.native is not a git identity. Compare repository paths as git stores them.";
const REALPATH_SYNC_MESSAGE =
  "Do not canonicalize paths with realpathSync for identity. Compare repository paths as git stores them.";
const STDERR_WRITE_MESSAGE =
  "Do not add direct process.stderr.write calls in library code. Return errors or let the CLI print.";
const CONSOLE_MESSAGE =
  "Do not use console output in library code. Return values or throw GritsError. CLI and the test runner may print.";

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

const noRealpathNative = defineRule({
  create(context) {
    return {
      MemberExpression(node) {
        if (memberPropertyName(node) !== "native") {
          return;
        }
        const object = (node as { object?: unknown }).object;
        if (memberPropertyName(object) === "realpathSync") {
          context.report({ node, message: REALPATH_NATIVE_MESSAGE });
        }
      },
    };
  },
});

const noRealpathSync = defineRule({
  create(context) {
    return {
      CallExpression(node) {
        const callee = (node as { callee?: unknown }).callee;
        if (memberPropertyName(callee) === "realpathSync") {
          context.report({ node, message: REALPATH_SYNC_MESSAGE });
        }
      },
    };
  },
});

const noProcessStderrWrite = defineRule({
  create(context) {
    return {
      CallExpression(node) {
        const callee = (node as { callee?: unknown }).callee;
        if (memberPropertyName(callee) !== "write") {
          return;
        }
        const object = callee && typeof callee === "object" ? (callee as { object?: unknown }).object : undefined;
        if (memberPropertyName(object) !== "stderr") {
          return;
        }
        const processObject = object && typeof object === "object" ? (object as { object?: unknown }).object : undefined;
        if (identName(processObject) === "process") {
          context.report({ node, message: STDERR_WRITE_MESSAGE });
        }
      },
    };
  },
});

const noConsoleOutput = defineRule({
  create(context) {
    return {
      CallExpression(node) {
        const callee = (node as { callee?: unknown }).callee;
        const method = memberPropertyName(callee);
        if (method !== "log" && method !== "error" && method !== "warn") {
          return;
        }
        const object = callee && typeof callee === "object" ? (callee as { object?: unknown }).object : undefined;
        if (identName(object) === "console") {
          context.report({ node, message: CONSOLE_MESSAGE });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "grits-bans" },
  rules: {
    "no-realpath-native": noRealpathNative,
    "no-realpath-sync": noRealpathSync,
    "no-process-stderr-write": noProcessStderrWrite,
    "no-console-output": noConsoleOutput,
  },
});
