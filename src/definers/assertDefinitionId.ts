import { validationError } from "../errors";
import { getDefinitionIdViolation } from "./definitionValidation";

export function assertDefinitionId(
  definitionType: string,
  id: unknown,
): asserts id is string {
  const violation = getDefinitionIdViolation(definitionType, id);
  if (violation) {
    validationError.throw(violation);
  }
}
