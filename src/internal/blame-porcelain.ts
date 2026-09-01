import { readCommit, readLooseObject, readTreeEntries } from "./git-object.js";
import { resolveHead } from "./resolve-head.js";

export async function blamePorcelain(
  repositoryPath: string,
  path?: string,
): Promise<string> {
  const headId = await resolveHead(repositoryPath);
  const commit = await readCommit(repositoryPath, headId);
  const tree = await readTreeEntries(repositoryPath, commit.tree);
  const entry = path === undefined ? tree[0] : tree.find((item) => item.name === path);
  if (entry === undefined) {
    throw new Error(`blame path not found: ${path ?? "(first entry)"}`);
  }
  const blob = await readLooseObject(repositoryPath, entry.id);
  const content = blob.payload.toString("utf8");
  const lines = content.endsWith("\n")
    ? content.slice(0, -1).split("\n")
    : content.split("\n");
  const summary = commit.message.replace(/\n+$/u, "").split("\n")[0];
  const chunks: string[] = [
    `${headId} 1 1 ${lines.length}`,
    `author ${commit.author.name}`,
    `author-mail <${commit.author.email}>`,
    `author-time ${commit.author.timestamp}`,
    `author-tz ${commit.author.tz}`,
    `committer ${commit.committer.name}`,
    `committer-mail <${commit.committer.email}>`,
    `committer-time ${commit.committer.timestamp}`,
    `committer-tz ${commit.committer.tz}`,
    `summary ${summary}`,
    commit.parents.length === 0 ? "boundary" : `previous ${commit.parents[0]} ${entry.name}`,
    `filename ${entry.name}`,
    `\t${lines[0]}`,
  ];
  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    chunks.push(`${headId} ${lineNumber} ${lineNumber}`, `\t${lines[index]}`);
  }
  return `${chunks.join("\n")}\n`;
}
