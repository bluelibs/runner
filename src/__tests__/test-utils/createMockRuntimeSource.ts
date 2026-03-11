import { runtimeSource } from "../../types/runtimeSource";

export const resolveMockDefinitionId = (
  reference: unknown,
): string | undefined => {
  if (typeof reference === "string") {
    return reference;
  }

  if (reference && typeof reference === "object" && "id" in reference) {
    const id = (reference as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }

  return undefined;
};

const resolveMockReferenceId = (reference: unknown): string => {
  const definitionId = resolveMockDefinitionId(reference);
  if (definitionId) {
    return definitionId;
  }

  return String(reference);
};

export const createMockRuntimeSource = (kind: string, reference: unknown) => {
  const id = resolveMockReferenceId(reference);

  switch (kind) {
    case "task":
      return runtimeSource.task(id);
    case "hook":
      return runtimeSource.hook(id);
    case "middleware":
      return runtimeSource.middleware(id);
    case "resource":
      return runtimeSource.resource(id);
    default:
      return runtimeSource.runtime(id);
  }
};
