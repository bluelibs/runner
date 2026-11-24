import { isResourceWithConfig } from "../../define";

/**
 * Reads an uncompiled source id string from a definition reference or configured wrapper.
 */
export function readDefinitionSourceId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (isResourceWithConfig(value)) {
    return value.resource.id;
  }

  if (
    ((typeof value === "object" && value !== null) ||
      typeof value === "function") &&
    "id" in value
  ) {
    const sourceId = (value as { id?: unknown }).id;
    if (typeof sourceId === "string" && sourceId.length > 0) {
      return sourceId;
    }
  }

  return undefined;
}
