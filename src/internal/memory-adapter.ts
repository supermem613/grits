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
}
