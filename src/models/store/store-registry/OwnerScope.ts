import { SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID } from "../../createSyntheticFrameworkRoot";

export type OwnerScope = Readonly<{
  resourceId: string;
  usesFrameworkRootIds: boolean;
}>;

export function createOwnerScope(resourceId: string): OwnerScope {
  return {
    resourceId,
    usesFrameworkRootIds: resourceId === SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID,
  };
}
