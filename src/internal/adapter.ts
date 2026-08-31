import type {
  GitObject,
  ObjectId,
  RefName,
  RefResolution,
} from "../api/types.js";

export interface RepositoryAdapter {
  read(id: ObjectId): Promise<GitObject>;
  resolve(name: RefName): Promise<RefResolution | null>;
  isAncestor(ancestor: ObjectId, descendant: ObjectId): Promise<boolean>;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}
