import { isOptional, isResource } from "../../define";

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

    if (isResource(value)) {
      resourceIds.push(value.id);
    }
  };

  Object.values(rawDependencies as Record<string, unknown>).forEach(collect);
  return resourceIds;
}
