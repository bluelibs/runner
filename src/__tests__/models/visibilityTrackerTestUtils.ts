export const resolveDefinitionId = (reference: unknown): string | undefined => {
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

export const getDisplayId = (id: string): string => id;

export function createVisibilityRegistry(
  overrides: Record<string, unknown> = {},
) {
  return {
    tasks: new Map(),
    events: new Map(),
    hooks: new Map(),
    taskMiddlewares: new Map(),
    resourceMiddlewares: new Map(),
    resources: new Map(),
    asyncContexts: new Map(),
    errors: new Map(),
    tags: new Map(),
    resolveDefinitionId,
    getDisplayId,
    ...overrides,
  };
}
