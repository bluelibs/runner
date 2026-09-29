import {
  IResource,
  ResourceStoreElementType,
  symbolDefinitionIdentity,
  symbolResourceIsolateDeclarations,
  symbolResourceSubtreeDeclarations,
  symbolResourceWithConfig,
} from "../../defs";
import { StoreRegistry } from "../store/StoreRegistry";

/** Keeps registration topology intact when replacing resource behavior. */
export function replaceResourceBehavior(
  base: IResource,
  override: IResource,
): IResource {
  return {
    ...base,
    init: override.init,
    context: override.context,
    ready: override.ready,
    cooldown: override.cooldown,
    dispose: override.dispose,
  };
}

/** Creates an independent lifecycle instance without re-registering its children. */
export function createScopedResource(
  registry: StoreRegistry,
  base: ResourceStoreElementType,
  id: string,
  ownerId: string,
  override?: IResource,
): IResource {
  const behavior = override
    ? replaceResourceBehavior(base.resource, override)
    : base.resource;
  const resource: IResource = {
    ...behavior,
    id,
    [symbolDefinitionIdentity]: {},
    register: [],
    overrides: [],
    subtree: undefined,
    isolate: undefined,
    [symbolResourceSubtreeDeclarations]: undefined,
    [symbolResourceIsolateDeclarations]: undefined,
  };
  registry.visibilityTracker.recordOwnership(ownerId, resource);
  registry.visibilityTracker.recordScopedResource(
    id,
    base.resource.id,
    override ? ownerId : base.resource.id,
  );
  return registry.storeResourceWithConfig({
    id,
    resource,
    config: base.config,
    [symbolResourceWithConfig]: true,
  });
}
