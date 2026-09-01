import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GritsError } from "../api/errors.js";
import { gitDir } from "./resolve-head.js";

export async function configGet(repositoryPath: string, key: string): Promise<string> {
  const text = await readFile(join(gitDir(repositoryPath), "config"), "utf8");
  const parts = key.split(".");
  if (parts.length < 2) {
    throw new GritsError("INVALID_CONFIG", `Config key ${key} is not valid.`, "diff.configShowOrigin");
  }
  const name = parts.at(-1) ?? key;
  const section =
    parts.length === 2 ? `[${parts[0]}]` : `[${parts[0]} "${parts.slice(1, -1).join(".")}"]`;
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inSection = trimmed.toLowerCase() === section.toLowerCase();
      continue;
    }
    if (!inSection) {
      continue;
    }
    const match = new RegExp(`^${name}\\s*=\\s*(.+)$`, "i").exec(trimmed);
    if (match !== null) {
      return match[1];
    }
  }
  throw new GritsError("NOT_FOUND", `Config key ${key} was not found.`, "diff.configShowOrigin");
}

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
