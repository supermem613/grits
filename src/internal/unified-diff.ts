import { hashBlob } from "./hash-blob.js";

type Op = { t: "=" | "+" | "-"; s: string };

export function unifiedDiff(
  leftPath: string,
  rightPath: string,
  left: Buffer,
  right: Buffer,
): string {
  if (Buffer.compare(left, right) === 0) {
    return "";
  }
  const a = hashBlob(left).slice(0, 7);
  const b = hashBlob(right).slice(0, 7);
  const body = formatHunks(splitLines(left.toString("utf8")), splitLines(right.toString("utf8")));
  return `diff --git a/${leftPath} b/${rightPath}\nindex ${a}..${b} 100644\n--- a/${leftPath}\n+++ b/${rightPath}\n${body}`;
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

function formatHunks(left: readonly string[], right: readonly string[]): string {
  const ops = myers(left, right);
  const changeIdx: number[] = [];
  ops.forEach((op, index) => {
    if (op.t !== "=") {
      changeIdx.push(index);
    }
  });
  if (changeIdx.length === 0) {
    return "";
  }
  const ctx = 3;
  const lo = Math.max(0, changeIdx[0] - ctx);
  const hi = Math.min(ops.length - 1, changeIdx[changeIdx.length - 1] + ctx);
  let aStart = 0;
  let bStart = 0;
  for (let index = 0; index < lo; index += 1) {
    if (ops[index].t !== "+") {
      aStart += 1;
    }
    if (ops[index].t !== "-") {
      bStart += 1;
    }
  }
  let aCount = 0;
  let bCount = 0;
  for (let index = lo; index <= hi; index += 1) {
    if (ops[index].t !== "+") {
      aCount += 1;
    }
    if (ops[index].t !== "-") {
      bCount += 1;
    }
  }
  const aHdr = aCount === 1 ? `${aStart + 1}` : `${aCount === 0 ? aStart : aStart + 1},${aCount}`;
  const bHdr = bCount === 1 ? `${bStart + 1}` : `${bCount === 0 ? bStart : bStart + 1},${bCount}`;
  const lines = [`@@ -${aHdr} +${bHdr} @@`];
  for (let index = lo; index <= hi; index += 1) {
    const op = ops[index];
    const prefix = op.t === "=" ? " " : op.t;
    lines.push(`${prefix}${op.s}`);
  }
  return `${lines.join("\n")}\n`;
}

function myers(left: readonly string[], right: readonly string[]): Op[] {
  const n = left.length;
  const m = right.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      ops.push({ t: "=", s: left[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: "-", s: left[i] });
      i += 1;
    } else {
      ops.push({ t: "+", s: right[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ t: "-", s: left[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ t: "+", s: right[j] });
    j += 1;
  }
  return ops;
}
