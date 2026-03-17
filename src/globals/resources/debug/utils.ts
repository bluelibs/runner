const FRAMEWORK_NAMESPACE_PREFIXES = ["system.", "runner."] as const;

export const isFrameworkDefinition = (definition: { id: string }): boolean =>
  FRAMEWORK_NAMESPACE_PREFIXES.some((prefix) =>
    String(definition.id).startsWith(prefix),
  );
