// Runtime typeof lives only in this module. Call sites decode through these predicates so no-runtime-typeof can stay on everywhere else.
export function isRuntimeString<T>(value: T): value is T & string {
  return typeof value === "string";
}

export function isRuntimeNumber<T>(value: T): value is T & number {
  return typeof value === "number";
}

export function isRuntimeBoolean<T>(value: T): value is T & boolean {
  return typeof value === "boolean";
}

export function isRuntimeFunction<T>(value: T): value is T & ((...args: never[]) => void) {
  return typeof value === "function";
}

export function isObjectOrNull<T>(value: T): value is T & (object | null) {
  return typeof value === "object";
}

export function isPlainObject<T>(value: T): value is T & object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString<T>(value: T): value is T & string {
  return typeof value === "string" && value.length > 0;
}

export function runtimeTypeName<T>(
  value: T,
): "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function" {
  return typeof value;
}
