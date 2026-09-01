import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readLooseBlob, writeLooseBlob } from "../../src/internal/loose-object.js";

test("reads a git-written loose blob", async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), "loose-blob-"));

  try {
    execFileSync("git", ["init", repositoryPath], { stdio: "ignore" });
    const oid = execFileSync(
      "git",
      ["-C", repositoryPath, "hash-object", "-w", "--stdin"],
      { input: "golden-blob\n" },
    )
      .toString()
      .trim();

    void writeLooseBlob;
    assert.equal(
      Buffer.from(await readLooseBlob(repositoryPath, oid)).toString("utf8"),
      "golden-blob\n",
    );
  } finally {
    rmSync(repositoryPath, { recursive: true, force: true });
  }
});
