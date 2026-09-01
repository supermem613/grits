export type GritsErrorCode =
  | "INVALID_CONFIG"
  | "UNSUPPORTED_CAPABILITY"
  | "NYI"
  | "NOT_FOUND"
  | "REPOSITORY_UNAVAILABLE";

export class GritsError extends Error {
  readonly code: GritsErrorCode;
  readonly operation: string;

  constructor(code: GritsErrorCode, message: string, operation: string) {
    super(message);
    this.name = "GritsError";
    this.code = code;
    this.operation = operation;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
