import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  advertisedDefaultBranch,
  lsRemoteHttps,
} from "../../src/internal/smart-http-ls-remote.js";

const HEAD_OID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MAIN_OID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function pkt(payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const length = (body.length + 4).toString(16).padStart(4, "0");
  return Buffer.concat([Buffer.from(length, "ascii"), body]);
}

function v2Advertisement(): Buffer {
  return Buffer.concat([
    pkt("# service=git-upload-pack\n"),
    Buffer.from("0000", "ascii"),
    pkt("version 2\n"),
    pkt("ls-refs\n"),
    pkt("fetch\n"),
    Buffer.from("0000", "ascii"),
  ]);
}

function lsRefsResult(): Buffer {
  return Buffer.concat([
    pkt(`${HEAD_OID} HEAD symref-target:refs/heads/main\n`),
    pkt(`${MAIN_OID} refs/heads/main\n`),
    Buffer.from("0000", "ascii"),
  ]);
}

describe("Smart HTTP v2 ls-remote", () => {
  it("lists HEAD and branch oids from protocol v2 ls-refs", async () => {
    const requested: string[] = [];
    const posts: string[] = [];
    const result = await lsRemoteHttps(
      "https://example.test/grits.git",
      async (url, init) => {
        const method = init?.method ?? "GET";
        requested.push(`${method} ${url}`);
        if (method === "GET") {
          return new Response(v2Advertisement(), {
            status: 200,
            headers: {
              "content-type": "application/x-git-upload-pack-advertisement",
            },
          });
        }
        posts.push(Buffer.from(init?.body ?? "").toString("utf8"));
        return new Response(lsRefsResult(), {
          status: 200,
          headers: {
            "content-type": "application/x-git-upload-pack-result",
          },
        });
      },
    );

    assert.deepEqual(requested, [
      "GET https://example.test/grits.git/info/refs?service=git-upload-pack",
      "POST https://example.test/grits.git/git-upload-pack",
    ]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].includes("command=ls-refs"), true);
    // Oids and names are the specification in the ls-refs fixture.
    assert.deepEqual(result.refs, [
      { name: "HEAD", oid: HEAD_OID },
      { name: "refs/heads/main", oid: MAIN_OID },
    ]);
    assert.equal(advertisedDefaultBranch(result), "main");
  });
});
