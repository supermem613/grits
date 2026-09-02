import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { gitDir, resolveHead } from "./resolve-head.js";

export async function worktreeListPorcelain(
  repositoryPath: string,
): Promise<string> {
  const headText = (await readFile(join(gitDir(repositoryPath), "HEAD"), "utf8")).trim();
  const headId = await resolveHead(repositoryPath);
  const worktreePath = (await realpath(repositoryPath)).replaceAll("\\", "/");
  const third = headText.toLowerCase().startsWith("ref:")
    ? `branch ${headText.slice(4).trim()}`
    : "detached";
  return `worktree ${worktreePath}\nHEAD ${headId}\n${third}\n\n`;
}
