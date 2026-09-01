import { GritsError } from "./api/errors.js";
import { FilesystemAdapter } from "./internal/filesystem-adapter.js";
import { MemoryAdapter } from "./internal/memory-adapter.js";
import type { RepositoryAdapter } from "./internal/adapter.js";
import type {
  CapabilityProfile,
  GitObject,
  Grits,
  GritsConfig,
  HistoryApi,
  MemorySeed,
  ObjectsApi,
  RefResolution,
  RefsApi,
  TreeEntry,
} from "./api/types.js";
import {
  isObjectOrNull,
  isPlainObject,
  isRuntimeNumber,
  isRuntimeString,
} from "./internal/runtime-type.js";

export { GritsError } from "./api/errors.js";
export type { GritsErrorCode } from "./api/errors.js";
export type {
  BlobObject,
  CapabilityProfile,
  CapabilityStatus,
  CommitObject,
  FilesystemRepository,
  GitObject,
  Grits,
  GritsConfig,
  HistoryApi,
  MemoryRepository,
  MemorySeed,
  ObjectId,
  ObjectsApi,
  RefName,
  RefResolution,
  RefsApi,
  RepositoryDescriptor,
  RepositoryKind,
  TreeEntry,
  TreeObject,
} from "./api/types.js";

function isTreeEntry<T>(value: T): value is T & TreeEntry {
  return (
    isPlainObject(value) &&
    "mode" in value &&
    isRuntimeString(value.mode) &&
    "name" in value &&
    isRuntimeString(value.name) &&
    "objectId" in value &&
    isRuntimeString(value.objectId)
  );
}

function isGitObject<T>(value: T): value is T & GitObject {
  if (
    !isPlainObject(value) ||
    !("kind" in value) ||
    !isRuntimeString(value.kind) ||
    !("id" in value) ||
    !isRuntimeString(value.id)
  ) {
    return false;
  }

  if (value.kind === "blob") {
    return (
      "bytes" in value &&
      Array.isArray(value.bytes) &&
      value.bytes.every((byte) => isRuntimeNumber(byte))
    );
  }

  if (value.kind === "tree") {
    return (
      "entries" in value &&
      Array.isArray(value.entries) &&
      value.entries.every(
        (entry) => isObjectOrNull(entry) && entry !== null && isTreeEntry(entry),
      )
    );
  }

  return (
    value.kind === "commit" &&
    "tree" in value &&
    isRuntimeString(value.tree) &&
    "message" in value &&
    isRuntimeString(value.message) &&
    "parents" in value &&
    Array.isArray(value.parents) &&
    value.parents.every((parent) => isRuntimeString(parent))
  );
}

function isRefResolution<T>(value: T): value is T & RefResolution {
  return (
    isPlainObject(value) &&
    "name" in value &&
    isRuntimeString(value.name) &&
    "objectId" in value &&
    isRuntimeString(value.objectId)
  );
}

function isMemorySeed<T>(value: T): value is T & MemorySeed {
  if (!isPlainObject(value)) {
    return false;
  }

  const objectsValid =
    !("objects" in value) ||
    value.objects === undefined ||
    (Array.isArray(value.objects) &&
      value.objects.every(
        (object) => isObjectOrNull(object) && object !== null && isGitObject(object),
      ));
  const refsValid =
    !("refs" in value) ||
    value.refs === undefined ||
    (Array.isArray(value.refs) &&
      value.refs.every(
        (ref) => isObjectOrNull(ref) && ref !== null && isRefResolution(ref),
      ));

  return objectsValid && refsValid;
}

function assertValidConfig(value: GritsConfig): void {
  if (!isObjectOrNull(value) || value === null || !isPlainObject(value)) {
    throw new GritsError(
      "INVALID_CONFIG",
      "A repository descriptor is required.",
      "createGrits",
    );
  }
  if (
    !("repository" in value) ||
    !isObjectOrNull(value.repository) ||
    value.repository === null ||
    !isPlainObject(value.repository)
  ) {
    throw new GritsError(
      "INVALID_CONFIG",
      "A repository descriptor is required.",
      "createGrits",
    );
  }

  const repository = value.repository;
  if (!("kind" in repository) || !isRuntimeString(repository.kind)) {
    throw new GritsError(
      "INVALID_CONFIG",
      "A valid filesystem or memory repository descriptor is required.",
      "createGrits",
    );
  }
  if (repository.kind === "filesystem") {
    if (
      !("path" in repository) ||
      !isRuntimeString(repository.path) ||
      repository.path.length === 0
    ) {
      throw new GritsError(
        "INVALID_CONFIG",
        "A non-empty filesystem path is required.",
        "createGrits",
      );
    }
    return;
  }

  if (repository.kind !== "memory") {
    throw new GritsError(
      "INVALID_CONFIG",
      "A valid filesystem or memory repository descriptor is required.",
      "createGrits",
    );
  }
  if (
    "seed" in repository &&
    repository.seed !== undefined &&
    (!isObjectOrNull(repository.seed) ||
      repository.seed === null ||
      !isMemorySeed(repository.seed))
  ) {
    throw new GritsError(
      "INVALID_CONFIG",
      "A valid filesystem or memory repository descriptor is required.",
      "createGrits",
    );
  }
}

export function createGrits(config: GritsConfig): Grits {
  assertValidConfig(config);

  const adapter: RepositoryAdapter =
    config.repository.kind === "memory"
      ? new MemoryAdapter(config.repository.seed)
      : new FilesystemAdapter(config.repository.path);

  const capabilities: CapabilityProfile = Object.freeze({
    repository: config.repository.kind,
    objects: Object.freeze({ read: "supported" }),
    refs: Object.freeze({ resolve: "supported" }),
    history: Object.freeze({ isAncestor: "supported" }),
  });

  const objects: ObjectsApi = Object.freeze({
    async read(id) {
      return adapter.read(id);
    },
  });

  const refs: RefsApi = Object.freeze({
    async resolve(name) {
      return adapter.resolve(name);
    },
  });

  const history: HistoryApi = Object.freeze({
    async isAncestor(ancestor, descendant) {
      return adapter.isAncestor(ancestor, descendant);
    },
  });

  return Object.freeze({
    capabilities,
    objects,
    refs,
    history,
  });
}
