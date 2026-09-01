import { strict as assert } from "node:assert";
import { GritsError, type GritsErrorCode } from "../../src/api/errors.js";

export function matchesGritsError(
  error: Error,
  code: GritsErrorCode,
  operation: string,
): boolean {
  assert.equal(error instanceof GritsError, true);
  if (!(error instanceof GritsError)) {
    return false;
  }
  assert.equal(error.code, code);
  assert.equal(error.operation, operation);
  return true;
}
