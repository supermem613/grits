import { readCommit, readLooseObject, readTreeEntries } from "./git-object.js";
import { resolveHead } from "./resolve-head.js";

export async function blamePorcelain(repositoryPath: string): Promise<string> {
  const headId = await resolveHead(repositoryPath);
  const commit = await readCommit(repositoryPath, headId);
  const tree = await readTreeEntries(repositoryPath, commit.tree);
  const entry = tree[0];
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
    "boundary",
    `filename ${entry.name}`,
    `\t${lines[0]}`,
    "",
  ];
  return chunks.join("\n");
}
