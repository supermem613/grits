import { GritsError } from "./api/errors.js";
import { FilesystemAdapter } from "./internal/filesystem-adapter.js";
import { MemoryAdapter } from "./internal/memory-adapter.js";
import type { RepositoryAdapter } from "./internal/adapter.js";
import type {
  CapabilityProfile,
  GitObject,
  Grits,
  GritsConfig,
  MemorySeed,
  ObjectsApi,
  RefResolution,
  RefsApi,
} from "./api/types.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGitObject(value: unknown): value is GitObject {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.id !== "string") {
    return false;
  }

  if (value.kind === "blob") {
    return Array.isArray(value.bytes) && value.bytes.every((byte) => typeof byte === "number");
  }

  if (value.kind === "tree") {
    return (
      Array.isArray(value.entries) &&
      value.entries.every(
        (entry) =>
          isRecord(entry) &&
          typeof entry.mode === "string" &&
          typeof entry.name === "string" &&
          typeof entry.objectId === "string",
      )
    );
  }

  return (
    value.kind === "commit" &&
    typeof value.tree === "string" &&
    typeof value.message === "string" &&
    Array.isArray(value.parents) &&
    value.parents.every((parent) => typeof parent === "string")
  );
}

function isRefResolution(value: unknown): value is RefResolution {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.objectId === "string"
  );
}

function isMemorySeed(value: unknown): value is MemorySeed {
  if (!isRecord(value)) {
    return false;
  }

  const objectsValid =
    value.objects === undefined ||
    (Array.isArray(value.objects) && value.objects.every((object) => isGitObject(object)));
  const refsValid =
    value.refs === undefined ||
    (Array.isArray(value.refs) && value.refs.every((ref) => isRefResolution(ref)));

  return objectsValid && refsValid;
}

function assertValidConfig(value: unknown): asserts value is GritsConfig {
  if (!isRecord(value) || !isRecord(value.repository)) {
    throw new GritsError(
      "INVALID_CONFIG",
      "A repository descriptor is required.",
      "createGrits",
    );
  }

  const repository = value.repository;
  if (repository.kind === "filesystem") {
    if (typeof repository.path !== "string" || repository.path.length === 0) {
      throw new GritsError(
        "INVALID_CONFIG",
        "A non-empty filesystem path is required.",
        "createGrits",
      );
    }
    return;
  }

  if (
    repository.kind !== "memory" ||
    (repository.seed !== undefined && !isMemorySeed(repository.seed))
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

  return Object.freeze({
    capabilities,
    objects,
    refs,
  });
}
