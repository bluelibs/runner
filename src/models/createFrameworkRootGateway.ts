import type {
  IResource,
  IResourceWithConfig,
  RegisterableItems,
} from "../defs";
import { defineResource } from "../define";
import { debugResource } from "../globals/resources/debug";
import type { DebugFriendlyConfig } from "../globals/resources/debug";
import {
  RUNNER_FRAMEWORK_ITEMS,
  SYSTEM_FRAMEWORK_ITEMS,
} from "./BuiltinsRegistry";

export const FRAMEWORK_RUNNER_RESOURCE_ID = "runner";
export const FRAMEWORK_SYSTEM_RESOURCE_ID = "system";
const FRAMEWORK_ROOT_GATEWAY_ID = "runtime-framework-root";

type FrameworkRootInput = {
  rootItem: IResource<any, any, any, any, any> | IResourceWithConfig<any, any>;
  debug: DebugFriendlyConfig | undefined;
};

function createFrameworkNamespaceResource(
  resourceId: string,
  register: readonly RegisterableItems[],
): IResource<void, Promise<void>> {
  return defineResource({
    id: resourceId,
    register: [...register],
  });
}

export function createFrameworkRootGateway({
  rootItem,
  debug,
}: FrameworkRootInput): IResource<void, Promise<void>> {
  const runnerRegister = debug
    ? [...RUNNER_FRAMEWORK_ITEMS, debugResource.with(debug)]
    : [...RUNNER_FRAMEWORK_ITEMS];

  const systemResource = createFrameworkNamespaceResource(
    FRAMEWORK_SYSTEM_RESOURCE_ID,
    SYSTEM_FRAMEWORK_ITEMS,
  );
  const runnerResource = createFrameworkNamespaceResource(
    FRAMEWORK_RUNNER_RESOURCE_ID,
    runnerRegister,
  );

  return defineResource({
    id: FRAMEWORK_ROOT_GATEWAY_ID,
    gateway: true,
    register: [systemResource, runnerResource, rootItem],
  });
}
