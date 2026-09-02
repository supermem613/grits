import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { git as gritsGit } from "../../src/index.js";
import { matchesGritsError } from "../helpers/grits-error.js";

type GitHistoryFixture = {
  path: string;
  first: string;
  second: string;
};

function createGitFixture(): GitHistoryFixture {
  const path = mkdtempSync(join(tmpdir(), "grits-history-"));
  const setup = (args: readonly string[]) => {
    execFileSync("git", [...args], {
      cwd: path,
      stdio: "ignore",
    });
  };

  setup(["init"]);
  setup(["config", "user.email", "grits-test@example.com"]);
  setup(["config", "user.name", "Grits Test"]);
  writeFileSync(join(path, "history.txt"), "first\n", "utf8");
  setup(["add", "history.txt"]);
  setup(["commit", "-m", "first"]);
  const first = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: path,
    encoding: "utf8",
  }).trim();

  writeFileSync(join(path, "history.txt"), "second\n", "utf8");
  setup(["add", "history.txt"]);
  setup(["commit", "-m", "second"]);
  const second = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: path,
    encoding: "utf8",
  }).trim();

  return { path, first, second };
}

describe("history.isAncestor", () => {
  it("has memory true, false, same-commit, and typed missing-input behavior", async () => {
    const repository = {
        kind: "memory" as const,
        seed: {
          objects: [
            {
              kind: "commit" as const,
              id: "memory-first",
              tree: "tree-first",
              parents: [],
              message: "first",
            },
            {
              kind: "commit" as const,
              id: "memory-second",
              tree: "tree-second",
              parents: ["memory-first"],
              message: "second",
            },
            {
              kind: "commit" as const,
              id: "memory-missing-parent",
              tree: "tree-missing-parent",
              parents: ["missing-parent"],
              message: "missing parent",
            },
            {
              kind: "tree" as const,
              id: "memory-tree-parent",
              entries: [],
            },
            {
              kind: "commit" as const,
              id: "memory-non-commit-parent",
              tree: "tree-non-commit-parent",
              parents: ["memory-tree-parent"],
              message: "non-commit parent",
            },
          ],
        },
    };

    const publicResult = await gritsGit.isAncestor({
      repository,
      rev: "memory-first",
      otherRev: "memory-second",
    });
    assert.equal(publicResult, "true");
    assert.equal(
      await gritsGit.isAncestor({
        repository,
        rev: "memory-second",
        otherRev: "memory-first",
      }),
      "false",
    );
    assert.equal(
      await gritsGit.isAncestor({
        repository,
        rev: "memory-first",
        otherRev: "memory-first",
      }),
      "true",
    );

    await assert.rejects(
      gritsGit.isAncestor({
        repository,
        rev: "missing-commit",
        otherRev: "memory-second",
      }),
      (error: Error) => matchesGritsError(error, "NOT_FOUND", "history.isAncestor"),
    );

    for (const descendantId of ["memory-missing-parent", "memory-non-commit-parent"]) {
      await assert.rejects(
        gritsGit.isAncestor({
          repository,
          rev: "memory-first",
          otherRev: descendantId,
        }),
        (error: Error) => matchesGritsError(error, "NOT_FOUND", "history.isAncestor"),
      );
    }
  });

  it("has filesystem true, false, and same-commit behavior", async () => {
    const fixture = createGitFixture();
    try {
      const repository = {
        kind: "filesystem" as const,
        path: fixture.path,
      };

      const publicResult = await gritsGit.isAncestor({
        repository,
        rev: fixture.first,
        otherRev: fixture.second,
      });
      assert.equal(publicResult, "true");
      assert.equal(
        await gritsGit.isAncestor({
          repository,
          rev: fixture.second,
          otherRev: fixture.first,
        }),
        "false",
      );
      assert.equal(
        await gritsGit.isAncestor({
          repository,
          rev: fixture.first,
          otherRev: fixture.first,
        }),
        "true",
      );
      await assert.rejects(
        gritsGit.isAncestor({
          repository,
          rev: "HEAD",
          otherRev: fixture.second,
        }),
        (error: Error) => matchesGritsError(error, "NOT_FOUND", "history.isAncestor"),
      );
    } finally {
      rmSync(fixture.path, { recursive: true, force: true });
    }
  });
});
