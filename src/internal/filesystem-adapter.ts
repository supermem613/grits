import { execFile } from "node:child_process";
import { GritsError } from "../api/errors.js";
import type {
  CommitObject,
  GitObject,
  ObjectId,
  RefName,
  RefResolution,
  TreeEntry,
  TreeObject,
} from "../api/types.js";
import { deepFreeze, type RepositoryAdapter } from "./adapter.js";

class GitCommandFailure extends Error {
  readonly spawnFailure: boolean;

  constructor(spawnFailure: boolean) {
    super();
    this.spawnFailure = spawnFailure;
  }
}

function runGit(repositoryPath: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      {
        cwd: repositoryPath,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error !== null) {
          const code = (error as NodeJS.ErrnoException).code;
          reject(new GitCommandFailure(typeof code === "string"));
          return;
        }

        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

function repositoryUnavailable(operation: string): GritsError {
  return new GritsError(
    "REPOSITORY_UNAVAILABLE",
    "The repository command could not be completed.",
    operation,
  );
}

function notFound(): GritsError {
  return new GritsError(
    "NOT_FOUND",
    "The requested object was not found.",
    "objects.read",
  );
}

function canonicalId(output: Buffer, operation: string): ObjectId {
  const id = output.toString("utf8").trim();
  if (!/^[0-9a-f]+$/i.test(id)) {
    throw repositoryUnavailable(operation);
  }
  return id;
}

function parseTree(output: Buffer, id: ObjectId): TreeObject {
  const entries: TreeEntry[] = [];
  let start = 0;

  while (start < output.length) {
    const end = output.indexOf(0, start);
    const recordEnd = end === -1 ? output.length : end;
    const record = output.subarray(start, recordEnd);
    const tab = record.indexOf(9);
    const firstSpace = record.indexOf(32);
    const secondSpace = record.indexOf(32, firstSpace + 1);

    if (tab === -1 || firstSpace === -1 || secondSpace === -1 || secondSpace > tab) {
      throw repositoryUnavailable("objects.read");
    }

    const mode = record.subarray(0, firstSpace).toString("utf8");
    const objectId = record.subarray(secondSpace + 1, tab).toString("utf8");
    const name = record.subarray(tab + 1).toString("utf8");
    if (mode.length === 0 || objectId.length === 0) {
      throw repositoryUnavailable("objects.read");
    }

    entries.push(
      deepFreeze({
        mode,
        name,
        objectId,
      }),
    );

    if (end === -1) {
      break;
    }
    start = end + 1;
  }

  return deepFreeze({
    kind: "tree",
    id,
    entries,
  });
}

function parseCommit(output: Buffer, id: ObjectId): CommitObject {
  const text = output.toString("utf8");
  const separator = text.indexOf("\n\n");
  if (separator === -1) {
    throw repositoryUnavailable("objects.read");
  }

  const treeLine = text
    .slice(0, separator)
    .split("\n")
    .find((line) => line.startsWith("tree "));
  if (treeLine === undefined) {
    throw repositoryUnavailable("objects.read");
  }

  const tree = treeLine.slice("tree ".length).trim();
  if (tree.length === 0) {
    throw repositoryUnavailable("objects.read");
  }

  const parents = text
    .slice(0, separator)
    .split("\n")
    .filter((line) => line.startsWith("parent "))
    .map((line) => line.slice("parent ".length).trim())
    .filter((parent) => parent.length > 0);

  return deepFreeze({
    kind: "commit",
    id,
    tree,
    parents,
    message: text.slice(separator + 2),
  });
}

export class FilesystemAdapter implements RepositoryAdapter {
  constructor(private readonly repositoryPath: string) {}

  private async ensureRepository(operation: string): Promise<void> {
    try {
      await runGit(this.repositoryPath, ["rev-parse", "--git-dir"]);
    } catch {
      throw repositoryUnavailable(operation);
    }
  }

  private async canonicalizeObject(id: ObjectId): Promise<ObjectId> {
    try {
      const output = await runGit(this.repositoryPath, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${id}^{object}`,
      ]);
      return canonicalId(output, "objects.read");
    } catch (error) {
      if (error instanceof GitCommandFailure && error.spawnFailure) {
        throw repositoryUnavailable("objects.read");
      }
      throw notFound();
    }
  }

  async read(id: ObjectId): Promise<GitObject> {
    await this.ensureRepository("objects.read");
    const canonical = await this.canonicalizeObject(id);

    let type: string;
    try {
      type = (await runGit(this.repositoryPath, ["cat-file", "-t", canonical]))
        .toString("utf8")
        .trim();
    } catch {
      throw repositoryUnavailable("objects.read");
    }

    if (type === "blob") {
      try {
        return deepFreeze({
          kind: "blob",
          id: canonical,
          bytes: Array.from(await runGit(this.repositoryPath, ["cat-file", "blob", canonical])),
        });
      } catch {
        throw repositoryUnavailable("objects.read");
      }
    }

    if (type === "tree") {
      try {
        return parseTree(
          await runGit(this.repositoryPath, ["ls-tree", "-z", canonical]),
          canonical,
        );
      } catch (error) {
        if (error instanceof GritsError) {
          throw error;
        }
        throw repositoryUnavailable("objects.read");
      }
    }

    if (type === "commit") {
      try {
        return parseCommit(
          await runGit(this.repositoryPath, ["cat-file", "commit", canonical]),
          canonical,
        );
      } catch (error) {
        if (error instanceof GritsError) {
          throw error;
        }
        throw repositoryUnavailable("objects.read");
      }
    }

    throw repositoryUnavailable("objects.read");
  }

  async resolve(name: RefName): Promise<RefResolution | null> {
    await this.ensureRepository("refs.resolve");

    let output: Buffer;
    try {
      output = await runGit(this.repositoryPath, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        name,
      ]);
    } catch (error) {
      if (error instanceof GitCommandFailure && error.spawnFailure) {
        throw repositoryUnavailable("refs.resolve");
      }
      return null;
    }

    const objectId = canonicalId(output, "refs.resolve");
    return deepFreeze({
      name,
      objectId,
    });
  }
}
