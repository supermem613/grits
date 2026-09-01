import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRuntimeNumber, isRuntimeString } from "../../src/internal/runtime-type.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

type HarnessRun = {
  status: number;
  stdout: string;
};

function runHarness(args: readonly string[]): HarnessRun {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_CHANNEL_FD;
  try {
    const stdout = execFileSync(process.execPath, ["test/run.mjs", ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (error) {
    const status =
      error instanceof Error && "status" in error && isRuntimeNumber(error.status)
        ? error.status
        : 1;
    const stdout =
      error instanceof Error && "stdout" in error && isRuntimeString(error.stdout)
        ? error.stdout
        : "";
    return { status, stdout };
  }
}

describe("test runner report", () => {
  it("prints a pass summary with duration and the slowest tests", () => {
    const run = runHarness(["test/unit/smoke.test.ts"]);
    const plain = stripAnsi(run.stdout);

    assert.equal(run.status, 0, run.stdout);
    assert.match(plain, /^PASS tests=1 files=1 pass=1 fail=0 durationMs=\d+$/m);
    assert.match(plain, /^# Slowest tests$/m);
    assert.match(plain, /^#\s+\d+\.\ds\s+test\/unit\/smoke\.test\.ts\s+loads$/m);
    assert.doesNotMatch(plain, /(^|\n)# tests\s+\d+/);
    assert.doesNotMatch(plain, /(^|\n)ok\s+\d+\s+-/);
  });

  it("prints slowest files when --verbose is set", () => {
    const run = runHarness(["--verbose", "test/unit/smoke.test.ts"]);
    const plain = stripAnsi(run.stdout);

    assert.equal(run.status, 0, run.stdout);
    assert.match(plain, /^# Slowest files$/m);
    assert.match(plain, /^#\s+\d+\.\ds\s+test\/unit\/smoke\.test\.ts\s+\(1 tests\)$/m);
  });
});
