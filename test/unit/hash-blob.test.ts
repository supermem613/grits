import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashBlob } from "../../src/internal/hash-blob.js";

describe("hashBlob", () => {
  it("matches git hash-object --stdin for golden-blob", () => {
    const directory = mkdtempSync(join(tmpdir(), "grits-hash-blob-"));

    try {
      execFileSync("git", ["init", "--quiet"], { cwd: directory });
      const gitOid = execFileSync("git", ["hash-object", "--stdin"], {
        cwd: directory,
        input: "golden-blob\n",
        encoding: "utf8",
      }).trim();

      assert.equal(hashBlob(Buffer.from("golden-blob\n")), gitOid);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
