// Cross-platform test runner — expands globs and runs each file under node:test.
// Sandboxes HOME/USERPROFILE to a tmpdir so tests cannot read the developer's
// real ~/.grits/ state, mirroring CI exactly. Set GRITS_TEST_REAL_HOME=1 to opt out.
//
// Avoids `node --test` worker subprocesses (their IPC pipe intermittently
// fails on Windows runners with deserialize errors). Uses one process per file
// and TAP only as the per-file capture format. Passing runs stay quiet except
// for duration, slowest tests, and optional verbose sections.
import { readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { minimatch } from "minimatch";
import { execFileSync } from "node:child_process";

const DEFAULT_PATTERN = "test/**/*.test.ts";
// Reporting-only. Copied from Soda's default 10s slow list, not a fail gate.
const DEFAULT_SLOW_THRESHOLD_MS = 10_000;

const style = {
  green: (value) => `\x1b[32m${value}\x1b[0m`,
  red: (value) => `\x1b[31m${value}\x1b[0m`,
  yellow: (value) => `\x1b[33m${value}\x1b[0m`,
  dim: (value) => `\x1b[2m${value}\x1b[0m`,
};

function usage(log = console.log) {
  log(`Usage: node test/run.mjs [options] [glob...]

Options:
--slow-threshold <ms>       Override the slow-test reporting threshold
--verbose                   Show slowest files and tests over the slow threshold
--help                      Show this help
`);
}

function parseArgs(argv, { log = console.log, error = console.error, exit = process.exit } = {}) {
  const opts = {
    patterns: [],
    slowThresholdMs: DEFAULT_SLOW_THRESHOLD_MS,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const valueAfterEquals = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : null;
    const key = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;

    if (key === "--help" || key === "-h") {
      usage(log);
      exit(0);
    } else if (key === "--verbose") {
      opts.verbose = true;
    } else if (key === "--slow-threshold") {
      opts.slowThresholdMs = Number(valueAfterEquals ?? argv[++i]);
    } else if (arg.startsWith("--")) {
      error(`Unknown option: ${arg}`);
      usage(log);
      exit(2);
    } else {
      opts.patterns.push(arg);
    }
  }

  if (opts.patterns.length === 0) {
    opts.patterns.push(DEFAULT_PATTERN);
  }
  return opts;
}

function discoverFiles(patterns) {
  const files = [];
  for (const pattern of patterns) {
    const baseDir = pattern.split(/[/\\]/)[0] || ".";
    const matched = readdirSync(baseDir, { recursive: true })
      .map((f) => join(baseDir, f).split("\\").join("/"))
      .filter((f) => minimatch(f, pattern));
    for (const file of matched) {
      if (!files.includes(file)) {
        files.push(file);
      }
    }
  }
  return files;
}

function parseTap(stdout, file) {
  const tests = parseInt((stdout.match(/^# tests (\d+)/m) ?? [])[1] ?? "0", 10);
  const pass = parseInt((stdout.match(/^# pass (\d+)/m) ?? [])[1] ?? "0", 10);
  const fail = parseInt((stdout.match(/^# fail (\d+)/m) ?? [])[1] ?? "0", 10);
  const testTimings = [];
  const lines = stdout.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^( *)(not )?ok \d+ - (.*)$/);
    if (!match) {
      continue;
    }
    const failed = Boolean(match[2]);
    const name = match[3];
    let durationMs = 0;
    let type = "test";
    if (lines[i + 1]?.trim() === "---") {
      for (let j = i + 2; j < lines.length; j += 1) {
        if (lines[j].trim() === "...") {
          break;
        }
        const duration = lines[j].match(/duration_ms:\s*([\d.]+)/);
        if (duration) {
          durationMs = Number(duration[1]);
        }
        const typeMatch = lines[j].match(/type:\s*'(\w+)'/);
        if (typeMatch) {
          type = typeMatch[1];
        }
      }
    }
    if (type === "test") {
      testTimings.push({ file, name, durationMs, status: failed ? "fail" : "pass" });
    }
  }

  return { tests, pass, fail, testTimings };
}

function printSection(title, rows, log) {
  if (rows.length === 0) {
    return;
  }
  log(style.dim(`# ${title}`));
  for (const row of rows) {
    log(row);
  }
}

function summaryLine(label, elapsedMs, totalTests, fileCount, totalPass, totalFail) {
  const fields = `tests=${totalTests} files=${fileCount} pass=${totalPass} fail=${totalFail} durationMs=${Math.max(0, Math.round(elapsedMs))}`;
  return label === "PASS" ? `${style.green("PASS")} ${fields}` : `${style.red("FAIL")} ${fields}`;
}

function childEnv(sandboxHome) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_CHANNEL_FD;
  if (sandboxHome) {
    env.HOME = sandboxHome;
    env.USERPROFILE = sandboxHome;
    env.LOCALAPPDATA = join(sandboxHome, "AppData", "Local");
  }
  return env;
}

function runFile(file, env) {
  const startedAt = Date.now();
  let stdout = "";
  let fileFailed = false;
  try {
    stdout = execFileSync(process.execPath, ["--import", "tsx", "--test-reporter=tap", file], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    fileFailed = true;
    stdout = (err.stdout ?? "").toString();
  }
  const parsed = parseTap(stdout, file);
  if (fileFailed && parsed.fail === 0) {
    parsed.fail += 1;
  }
  return {
    file,
    stdout,
    code: fileFailed || parsed.fail > 0 ? 1 : 0,
    tests: parsed.tests,
    pass: parsed.pass,
    fail: parsed.fail,
    testTimings: parsed.testTimings,
    durationMs: Date.now() - startedAt,
  };
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const allFiles = discoverFiles(opts.patterns);
  if (allFiles.length === 0) {
    console.error(`No test files found matching: ${opts.patterns.join(", ")}`);
    process.exit(1);
  }

  const sandboxHome = process.env.GRITS_TEST_REAL_HOME
    ? null
    : mkdtempSync(join(tmpdir(), "grits-test-home-"));
  const env = childEnv(sandboxHome);
  const startedAt = Date.now();
  const results = [];
  const failedFiles = [];

  try {
    for (const file of allFiles) {
      const result = runFile(file, env);
      results.push(result);
      if (result.code !== 0) {
        failedFiles.push(file);
        console.log(
          `${style.red("FAIL")} ${file}   failed=${result.fail}   total=${result.tests}   durationMs=${Math.max(0, Math.round(result.durationMs))}`,
        );
        process.stdout.write(result.stdout);
      }
    }
  } finally {
    if (sandboxHome) {
      rmSync(sandboxHome, { recursive: true, force: true });
    }
  }

  const totalTests = results.reduce((sum, result) => sum + result.tests, 0);
  const totalPass = results.reduce((sum, result) => sum + result.pass, 0);
  const totalFail = results.reduce((sum, result) => sum + result.fail, 0);
  const elapsedMs = Date.now() - startedAt;
  const exitCode = failedFiles.length ? 1 : 0;
  const allTests = results.flatMap((result) => result.testTimings);
  const slowFiles = [...results].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
  const slowTests = [...allTests].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
  const thresholdTests = allTests
    .filter((test) => test.durationMs >= opts.slowThresholdMs)
    .sort((a, b) => b.durationMs - a.durationMs);

  if (failedFiles.length) {
    console.log("");
  }
  console.log(summaryLine(exitCode === 0 ? "PASS" : "FAIL", elapsedMs, totalTests, results.length, totalPass, totalFail));
  printSection(
    "Failures",
    failedFiles.map((file) => style.red(`#   ${file}`)),
    console.log,
  );
  printSection(
    "Slowest tests",
    slowTests.map((test) => style.yellow(`#   ${(test.durationMs / 1000).toFixed(1)}s  ${test.file}  ${test.name}`)),
    console.log,
  );
  if (opts.verbose) {
    printSection(
      "Slowest files",
      slowFiles.map((result) => style.yellow(`#   ${(result.durationMs / 1000).toFixed(1)}s  ${result.file}  (${result.tests} tests)`)),
      console.log,
    );
    printSection(
      `Tests over slow threshold (${(opts.slowThresholdMs / 1000).toFixed(1)}s)`,
      thresholdTests.map((test) => style.yellow(`#   ${(test.durationMs / 1000).toFixed(1)}s  ${test.file}  ${test.name}`)),
      console.log,
    );
  }

  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
