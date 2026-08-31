import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createGrits, GritsError } from "../../src/index.js";

function createGitFixture(): { path: string; first: string; second: string } {
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
    const grits = createGrits({
      repository: {
        kind: "memory",
        seed: {
          objects: [
            {
              kind: "commit",
              id: "memory-first",
              tree: "tree-first",
              parents: [],
              message: "first",
            },
            {
              kind: "commit",
              id: "memory-second",
              tree: "tree-second",
              parents: ["memory-first"],
              message: "second",
            },
            {
              kind: "commit",
              id: "memory-missing-parent",
              tree: "tree-missing-parent",
              parents: ["missing-parent"],
              message: "missing parent",
            },
            {
              kind: "tree",
              id: "memory-tree-parent",
              entries: [],
            },
            {
              kind: "commit",
              id: "memory-non-commit-parent",
              tree: "tree-non-commit-parent",
              parents: ["memory-tree-parent"],
              message: "non-commit parent",
            },
          ],
        },
      },
    });

    const publicResult = await grits.history.isAncestor("memory-first", "memory-second");
    assert.equal(typeof publicResult, "boolean");
    assert.equal(publicResult, true);
    assert.equal(
      await grits.history.isAncestor("memory-second", "memory-first"),
      false,
    );
    assert.equal(
      await grits.history.isAncestor("memory-first", "memory-first"),
      true,
    );

    await assert.rejects(
      grits.history.isAncestor("missing-commit", "memory-second"),
      (error: unknown) => {
        assert.equal(error instanceof GritsError, true);
        assert.equal((error as GritsError).code, "NOT_FOUND");
        assert.equal((error as GritsError).operation, "history.isAncestor");
        return true;
      },
    );

    for (const descendantId of ["memory-missing-parent", "memory-non-commit-parent"]) {
      await assert.rejects(
        grits.history.isAncestor("memory-first", descendantId),
        (error: unknown) => {
          assert.equal(error instanceof GritsError, true);
          assert.equal((error as GritsError).code, "NOT_FOUND");
          assert.equal((error as GritsError).operation, "history.isAncestor");
          return true;
        },
      );
    }
  });

  it("has filesystem true, false, and same-commit behavior", async () => {
    const fixture = createGitFixture();
    try {
      const grits = createGrits({
        repository: {
          kind: "filesystem",
          path: fixture.path,
        },
      });

      const publicResult = await grits.history.isAncestor(fixture.first, fixture.second);
      assert.equal(typeof publicResult, "boolean");
      assert.equal(publicResult, true);
      assert.equal(
        await grits.history.isAncestor(fixture.second, fixture.first),
        false,
      );
      assert.equal(
        await grits.history.isAncestor(fixture.first, fixture.first),
        true,
      );
      await assert.rejects(
        grits.history.isAncestor("HEAD", fixture.second),
        (error: unknown) => {
          assert.equal(error instanceof GritsError, true);
          assert.equal((error as GritsError).code, "NOT_FOUND");
          assert.equal((error as GritsError).operation, "history.isAncestor");
          return true;
        },
      );
    } finally {
      rmSync(fixture.path, { recursive: true, force: true });
    }
  });
});
