import type { IResource, IResourceWithConfig, RegisterableItem } from "../defs";
import { defineResource } from "../define";
import { asyncContexts } from "../asyncContexts";
import { debugResource } from "../globals/resources/debug";
import { globalResources } from "../globals/globalResources";
import { identityContextResource } from "../globals/resources/identityContext.resource";
import type { DebugFriendlyConfig } from "../globals/resources/debug";
import type { ExecutionContextConfig } from "../types/executionContext";
import type { IdentityAsyncContext } from "../types/runner";
import { frameworkNamespaceMetaPolicy } from "./frameworkNamespaceMetaPolicy";
import {
  RUNNER_FRAMEWORK_ITEMS,
  SYSTEM_FRAMEWORK_ITEMS,
} from "./BuiltinsRegistry";

export const FRAMEWORK_RUNNER_RESOURCE_ID = "runner";
export const FRAMEWORK_SYSTEM_RESOURCE_ID = "system";
export const SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID = "runtime-framework-root";

const FRAMEWORK_NAMESPACE_META = {
  [FRAMEWORK_SYSTEM_RESOURCE_ID]: {
    title: "System Namespace",
    description:
      "Synthetic framework namespace that owns Runner's locked internal infrastructure such as store, eventManager, taskRunner, middlewareManager, runtime, and lifecycle events.",
  },
  [FRAMEWORK_RUNNER_RESOURCE_ID]: {
    title: "Runner Namespace",
    description:
      "Synthetic framework namespace that owns built-in Runner utilities such as mode, health, timers, logger, serializer, queue, core tags, middleware, framework errors, and optional debug/execution-context resources.",
  },
} as const;

const FRAMEWORK_ROOT_META = {
  title: "Framework Root",
  description:
    "Transparent synthetic bootstrap root that registers the system namespace, runner namespace, and the user app root into a single runtime graph.",
} as const;

type FrameworkNamespaceResourceId =
  | typeof FRAMEWORK_SYSTEM_RESOURCE_ID
  | typeof FRAMEWORK_RUNNER_RESOURCE_ID;

type FrameworkRootInput = {
  rootItem: IResource<any, any, any, any, any> | IResourceWithConfig<any, any>;
  debug: DebugFriendlyConfig | undefined;
  executionContext?: ExecutionContextConfig | null;
  identity?: IdentityAsyncContext | null;
};

function createFrameworkNamespaceResource(
  resourceId: FrameworkNamespaceResourceId,
  register: readonly RegisterableItem[],
): IResource<void, Promise<void>> {
  return defineResource({
    id: resourceId,
    meta: FRAMEWORK_NAMESPACE_META[resourceId],
    subtree: frameworkNamespaceMetaPolicy,
    register: [...register],
  });
}

export function createSyntheticFrameworkRoot({
  rootItem,
  debug,
  executionContext = null,
  identity = null,
}: FrameworkRootInput): IResource<void, Promise<void>> {
  const runnerRegister = [...RUNNER_FRAMEWORK_ITEMS];
  const identityContext = identity ?? asyncContexts.identity;
  const shouldRegisterBuiltInIdentity =
    identityContext === asyncContexts.identity ||
    identityContext.id !== asyncContexts.identity.id;

  // Keep the public built-in identity context available in the runner
  // namespace unless the selected runtime identity already occupies that slot.
  if (shouldRegisterBuiltInIdentity) {
    runnerRegister.push(asyncContexts.identity);
  }

  runnerRegister.push(
    identityContextResource.with({
      context: identityContext,
    }),
  );

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
    meta: FRAMEWORK_ROOT_META,
    register: [systemResource, runnerResource, rootItem],
  });
}

export const createFrameworkRootGateway = createSyntheticFrameworkRoot;
