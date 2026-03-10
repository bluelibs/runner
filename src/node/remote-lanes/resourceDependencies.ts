import { resolveRemoteLanesMode, type RemoteLanesMode } from "./mode";

type ResourceWithId = {
  id: string;
};

export function collectRemoteLaneResourceDependencies<
  TBinding,
  TResource extends ResourceWithId,
>(options: {
  mode: RemoteLanesMode | undefined;
  bindings: readonly TBinding[];
  getResource: (binding: TBinding) => TResource | undefined;
  toDependencyKey: (resourceId: string) => string;
}): Record<string, TResource> {
  const { mode, bindings, getResource, toDependencyKey } = options;
  if (resolveRemoteLanesMode(mode) !== "network") {
    return {};
  }

  const dependencies: Record<string, TResource> = {};
  for (const binding of bindings) {
    const resource = getResource(binding);
    if (!resource) {
      continue;
    }

    dependencies[toDependencyKey(resource.id)] = resource;
  }

  return dependencies;
}
