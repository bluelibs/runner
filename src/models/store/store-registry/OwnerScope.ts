import { SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID } from "../../createSyntheticFrameworkRoot";
import {
  createCanonicalId,
  type CanonicalId,
} from "../../../tools/definitionId";

export type OwnerScope = Readonly<{
  resourceId: CanonicalId;
  usesFrameworkRootIds: boolean;
}>;

export function createOwnerScope(resourceId: string): OwnerScope {
  return {
    resourceId: createCanonicalId(resourceId),
    usesFrameworkRootIds: resourceId === SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID,
  };
}
