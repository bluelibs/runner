import { symbolFrameworkDefinition } from "../types/symbols";

export function markFrameworkDefinition<T extends object>(definition: T): T {
  return {
    ...definition,
    [symbolFrameworkDefinition]: true,
  } as T;
}

export function isFrameworkDefinitionMarked(definition: unknown): boolean {
  if (
    definition === null ||
    definition === undefined ||
    (typeof definition !== "object" && typeof definition !== "function")
  ) {
    return false;
  }

  return (
    (definition as Record<PropertyKey, unknown>)[symbolFrameworkDefinition] ===
    true
  );
}
