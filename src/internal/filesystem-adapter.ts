import { existsSync } from "node:fs";
import { join } from "node:path";
import { GritsError } from "../api/errors.js";
import type {
  CommitObject,
  GitObject,
  ObjectId,
  RefName,
  RefResolution,
  TreeObject,
} from "../api/types.js";
import { deepFreeze, type RepositoryAdapter } from "./adapter.js";
import { parseCommit, parseTree, readLooseObject } from "./git-object.js";
import { gitDir, resolveHead, resolveRef } from "./resolve-head.js";

const OID = /^[0-9a-f]{40}$/i;

function repositoryUnavailable(operation: string): GritsError {
  return new GritsError(
    "REPOSITORY_UNAVAILABLE",
    "The repository command could not be completed.",
    operation,
  );
}

function notFound(operation = "objects.read"): GritsError {
  return new GritsError("NOT_FOUND", "The requested object was not found.", operation);
}

export class FilesystemAdapter implements RepositoryAdapter {
  constructor(private readonly repositoryPath: string) {}

  private ensureRepository(operation: string): void {
    if (!existsSync(join(gitDir(this.repositoryPath), "HEAD"))) {
      throw repositoryUnavailable(operation);
    }
  }

  private async readObject(id: ObjectId, operation: string) {
    if (!OID.test(id)) {
      throw notFound(operation);
    }
    const canonical = id.toLowerCase();
    try {
      return await readLooseObject(this.repositoryPath, canonical);
    } catch (error) {
      if (error instanceof GritsError) {
        throw error;
      }
      throw notFound(operation);
    }
  }

  async read(id: ObjectId): Promise<GitObject> {
    this.ensureRepository("objects.read");
    const canonical = OID.test(id) ? id.toLowerCase() : id;
    const object = await this.readObject(id, "objects.read");

    if (object.type === "blob") {
      return deepFreeze({
        kind: "blob",
        id: canonical,
        bytes: Array.from(object.payload),
      });
    }

    if (object.type === "tree") {
      const tree: TreeObject = {
        kind: "tree",
        id: canonical,
        entries: parseTree(object.payload).map((entry) =>
          deepFreeze({
            mode: entry.mode,
            name: entry.name,
            objectId: entry.id,
          }),
        ),
      };
      return deepFreeze(tree);
    }

    if (object.type === "commit") {
      const parsed = parseCommit(object.payload);
      const commit: CommitObject = {
        kind: "commit",
        id: canonical,
        tree: parsed.tree,
        parents: parsed.parents,
        message: parsed.message,
      };
      return deepFreeze(commit);
    }

    throw repositoryUnavailable("objects.read");
  }

  async resolve(name: RefName): Promise<RefResolution | null> {
    this.ensureRepository("refs.resolve");
    try {
      if (name === "HEAD") {
        return deepFreeze({ name, objectId: await resolveHead(this.repositoryPath) });
      }
      return deepFreeze({ name, objectId: await resolveRef(this.repositoryPath, name) });
    } catch (error) {
      if (error instanceof GritsError && error.code === "REPOSITORY_UNAVAILABLE") {
        throw error;
      }
    }
    if (OID.test(name)) {
      try {
        await this.readObject(name, "refs.resolve");
        return deepFreeze({ name, objectId: name.toLowerCase() });
      } catch (error) {
        if (error instanceof GritsError && error.code === "NYI") {
          throw error;
        }
        return null;
      }
    }
    return null;
  }

  async isAncestor(ancestor: ObjectId, descendant: ObjectId): Promise<boolean> {
    const operation = "history.isAncestor";
    this.ensureRepository(operation);
    const canonicalAncestor = await this.requireCommit(ancestor, operation);
    const canonicalDescendant = await this.requireCommit(descendant, operation);
    if (canonicalAncestor === canonicalDescendant) {
      return true;
    }
    const seen = new Set<string>();
    const stack = [canonicalDescendant];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current)) {
        continue;
      }
      seen.add(current);
      if (current === canonicalAncestor) {
        return true;
      }
      const object = await this.read(current);
      if (object.kind !== "commit") {
        throw notFound(operation);
      }
      for (const parent of object.parents) {
        stack.push(parent);
      }
    }
    return false;
  }

  private async requireCommit(id: ObjectId, operation: string): Promise<ObjectId> {
    const object = await this.readObject(id, operation);
    if (object.type !== "commit") {
      throw notFound(operation);
    }
    return id.toLowerCase();
  }
}
