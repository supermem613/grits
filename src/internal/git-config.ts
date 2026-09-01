import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GritsError } from "../api/errors.js";
import { gitDir } from "./resolve-head.js";

export async function originUrl(repositoryPath: string): Promise<string> {
  const text = await readFile(join(gitDir(repositoryPath), "config"), "utf8");
  let inOrigin = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inOrigin = /^\[remote "origin"\]$/i.test(trimmed);
      continue;
    }
    if (!inOrigin) {
      continue;
    }
    const match = /^url\s*=\s*(.+)$/i.exec(trimmed);
    if (match !== null) {
      return match[1];
    }
  }

  throw new GritsError(
    "NOT_FOUND",
    "remote.origin.url was not found.",
    "remote.originUrl",
  );
}
