import { FRAMEWORK_ROOT_RESOURCE_ID } from "../createFrameworkRootGateway";

export type OwnerScope = Readonly<{
  resourceId: string;
  usesFrameworkRootIds: boolean;
}>;

export function createOwnerScope(resourceId: string): OwnerScope {
  return {
    resourceId,
    usesFrameworkRootIds: resourceId === FRAMEWORK_ROOT_RESOURCE_ID,
  };
}
