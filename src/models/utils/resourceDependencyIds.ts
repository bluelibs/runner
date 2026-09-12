import { isOptional, isResource, isResourceWithConfig } from "../../define";

export function getResourceDependencyIds(rawDependencies: unknown): string[] {
  if (!rawDependencies || typeof rawDependencies !== "object") {
    return [];
  }

  const resourceIds: string[] = [];
  const collect = (value: unknown): void => {
    if (isOptional(value)) {
      collect((value as { inner: unknown }).inner);
      return;
    }

    if (isResource(value) || isResourceWithConfig(value)) {
      resourceIds.push(value.id);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(collect);
    }
  };

  Object.values(rawDependencies as Record<string, unknown>).forEach(collect);
  return resourceIds;
}
