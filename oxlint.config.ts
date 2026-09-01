import { defineConfig } from "oxlint";

const syntaxBans = {
  "grits-bans/no-realpath-native": "error",
  "grits-bans/no-realpath-sync": "error",
  "grits-bans/no-process-stderr-write": "error",
  "grits-bans/no-console-output": "error",
} as const;

const coreLint = {
  curly: ["error", "all"],
  "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
} as const;

const antiSlopError = {
  "anti-slop/no-chained-type-assertions": "error",
  "anti-slop/no-conditional-empty-object-spread": "error",
  "anti-slop/no-known-value-widening": "error",
  "anti-slop/no-module-mocking": "error",
  "anti-slop/no-object-parameters": "error",
  "anti-slop/no-reflect-apply": "error",
  "anti-slop/no-reflect-get": "error",
  "anti-slop/no-runtime-typeof": "error",
  "anti-slop/no-shape-in-symbol-names": "error",
  "anti-slop/no-unknown-parameters": "error",
  "anti-slop/no-unknown-returns": "error",
  "anti-slop/no-unknown-type-aliases": "error",
  "anti-slop/no-unsafe-dictionary-type": "error",
  "anti-slop/no-widen-then-assert": "error",
  "anti-slop/require-safety-comment-for-type-assertion": "error",
} as const;

export default defineConfig({
  ignorePatterns: ["dist", "node_modules", "tools/oxlint"],
  categories: {
    correctness: "off",
    nursery: "off",
    pedantic: "off",
    perf: "off",
    restriction: "off",
    style: "off",
    suspicious: "off",
  },
  jsPlugins: [
    "./tools/oxlint/grits-bans/index.ts",
    "./tools/oxlint/grits-anti-slop/index.ts",
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
  ],
  rules: {
    ...coreLint,
    ...antiSlopError,
  },
  overrides: [
    {
      files: ["src/**/*.ts"],
      rules: syntaxBans,
    },
    {
      files: ["test/**/*.ts"],
      rules: {
        "grits-anti-slop/no-mock-call-order": "error",
        "grits-anti-slop/no-vacuous-throws": "error",
      },
    },
    {
      files: ["src/internal/runtime-type.ts"],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
      },
    },
  ],
});
