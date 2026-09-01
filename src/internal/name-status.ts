import { firstParentId, readCommit, readTreeEntries } from "./git-object.js";
import { resolveHead } from "./resolve-head.js";

export async function nameStatusHeadParent(
  repositoryPath: string,
): Promise<string> {
  const headId = await resolveHead(repositoryPath);
  const parentId = await firstParentId(repositoryPath);
  const headTree = await readTreeEntries(
    repositoryPath,
    (await readCommit(repositoryPath, headId)).tree,
  );
  const parentTree = await readTreeEntries(
    repositoryPath,
    (await readCommit(repositoryPath, parentId)).tree,
  );
  const parentByName = new Map(parentTree.map((entry) => [entry.name, entry]));
  const headByName = new Map(headTree.map((entry) => [entry.name, entry]));
  const names = [...new Set([...parentByName.keys(), ...headByName.keys()])].sort();
  const lines: string[] = [];
  for (const name of names) {
    const parent = parentByName.get(name);
    const head = headByName.get(name);
    if (parent === undefined && head !== undefined) {
      lines.push(`A\t${name}`);
    } else if (parent !== undefined && head === undefined) {
      lines.push(`D\t${name}`);
    } else if (parent !== undefined && head !== undefined && parent.id !== head.id) {
      lines.push(`M\t${name}`);
    }
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
