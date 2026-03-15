import type { IResource, IResourceWithConfig, RegisterableItem } from "../defs";
import { defineResource } from "../define";
import { debugResource } from "../globals/resources/debug";
import { globalResources } from "../globals/globalResources";
import type { DebugFriendlyConfig } from "../globals/resources/debug";
import type { ExecutionContextConfig } from "../types/executionContext";
import {
  RUNNER_FRAMEWORK_ITEMS,
  SYSTEM_FRAMEWORK_ITEMS,
} from "./BuiltinsRegistry";

export const FRAMEWORK_RUNNER_RESOURCE_ID = "runner";
export const FRAMEWORK_SYSTEM_RESOURCE_ID = "system";
export const SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID = "runtime-framework-root";

type FrameworkRootInput = {
  rootItem: IResource<any, any, any, any, any> | IResourceWithConfig<any, any>;
  debug: DebugFriendlyConfig | undefined;
  executionContext?: ExecutionContextConfig | null;
};

function createFrameworkNamespaceResource(
  resourceId: string,
  register: readonly RegisterableItem[],
): IResource<void, Promise<void>> {
  return defineResource({
    id: resourceId,
    register: [...register],
  });
}

export function createSyntheticFrameworkRoot({
  rootItem,
  debug,
  executionContext = null,
}: FrameworkRootInput): IResource<void, Promise<void>> {
  const runnerRegister = [...RUNNER_FRAMEWORK_ITEMS];

  if (executionContext) {
    runnerRegister.push(
      globalResources.executionContext.with({
        createCorrelationId: executionContext.createCorrelationId,
        frames: executionContext.frames,
        cycleDetection: executionContext.cycleDetection ?? false,
      }),
    );
  }

  if (debug) {
    runnerRegister.push(debugResource.with(debug));
  }

  const systemResource = createFrameworkNamespaceResource(
    FRAMEWORK_SYSTEM_RESOURCE_ID,
    SYSTEM_FRAMEWORK_ITEMS,
  );
  const runnerResource = createFrameworkNamespaceResource(
    FRAMEWORK_RUNNER_RESOURCE_ID,
    runnerRegister,
  );

  return defineResource({
    id: SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID,
    register: [systemResource, runnerResource, rootItem],
  });
}

export const createFrameworkRootGateway = createSyntheticFrameworkRoot;
