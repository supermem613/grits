import type {
  GitObject,
  ObjectId,
  RefName,
  RefResolution,
} from "../api/types.js";
import { isObjectOrNull } from "./runtime-type.js";

export interface RepositoryAdapter {
  read(id: ObjectId): Promise<GitObject>;
  resolve(name: RefName): Promise<RefResolution | null>;
  isAncestor(ancestor: ObjectId, descendant: ObjectId): Promise<boolean>;
}

export function deepFreeze<T>(value: T): T {
  if (!isObjectOrNull(value) || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}
