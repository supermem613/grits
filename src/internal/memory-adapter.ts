import { GritsError } from "../api/errors.js";
import type {
  GitObject,
  MemorySeed,
  ObjectId,
  RefName,
  RefResolution,
} from "../api/types.js";
import { deepFreeze, type RepositoryAdapter } from "./adapter.js";

function snapshotObject(object: GitObject): GitObject {
  if (object.kind === "blob") {
    return deepFreeze({
      kind: "blob",
      id: object.id,
      bytes: [...object.bytes],
    });
  }

  if (object.kind === "tree") {
    return deepFreeze({
      kind: "tree",
      id: object.id,
      entries: object.entries.map((entry) =>
        deepFreeze({
          mode: entry.mode,
          name: entry.name,
          objectId: entry.objectId,
        }),
      ),
    });
  }

  return deepFreeze({
    kind: "commit",
    id: object.id,
    tree: object.tree,
    parents: [...object.parents],
    message: object.message,
  });
}

function snapshotRef(ref: RefResolution): RefResolution {
  return deepFreeze({
    name: ref.name,
    objectId: ref.objectId,
  });
}

export class MemoryAdapter implements RepositoryAdapter {
  private readonly objects = new Map<ObjectId, GitObject>();
  private readonly refs = new Map<RefName, RefResolution>();

  constructor(seed?: MemorySeed) {
    for (const object of seed?.objects ?? []) {
      const snapshot = snapshotObject(object);
      this.objects.set(snapshot.id, snapshot);
    }

    for (const ref of seed?.refs ?? []) {
      const snapshot = snapshotRef(ref);
      this.refs.set(snapshot.name, snapshot);
    }
  }

  async read(id: ObjectId): Promise<GitObject> {
    const object = this.objects.get(id);
    if (object === undefined) {
      throw new GritsError(
        "NOT_FOUND",
        "The requested object was not found.",
        "objects.read",
      );
    }

    return object;
  }

  async resolve(name: RefName): Promise<RefResolution | null> {
    return this.refs.get(name) ?? null;
  }

  async isAncestor(ancestor: ObjectId, descendant: ObjectId): Promise<boolean> {
    const ancestorObject = this.objects.get(ancestor);
    const descendantObject = this.objects.get(descendant);
    if (ancestorObject?.kind !== "commit" || descendantObject?.kind !== "commit") {
      throw new GritsError(
        "NOT_FOUND",
        "The requested commit was not found.",
        "history.isAncestor",
      );
    }

    const visited = new Set<ObjectId>();
    const pending = [descendantObject.id];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || visited.has(current)) {
        continue;
      }
      visited.add(current);

      if (current === ancestorObject.id) {
        return true;
      }

      const currentObject = this.objects.get(current);
      if (currentObject?.kind !== "commit") {
        throw new GritsError(
          "NOT_FOUND",
          "The requested commit was not found.",
          "history.isAncestor",
        );
      }

      for (const parent of currentObject.parents) {
        if (this.objects.get(parent)?.kind !== "commit") {
          throw new GritsError(
            "NOT_FOUND",
            "The requested commit was not found.",
            "history.isAncestor",
          );
        }
        pending.push(parent);
      }
    }

    return false;
  }
}
