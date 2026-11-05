import { resources } from "../../../public";
import { durableEventTag } from "../bridge/tag";
import { durableEventBridgeResource } from "../bridge/resource";
import { isSameDefinition } from "../../../tools/isSameDefinition";
import { durableExecutionInvariantError } from "../../../errors";
import { defineResource } from "../../../definers/defineResource";
import { durableEventsArray } from "../events";
import { durableRuntimeTag } from "../tags/durableRuntime.tag";
import { durableWorkflowTag } from "../tags/durableWorkflow.tag";
import { durableShutdownAbortingHook } from "./durableShutdownAborting.hook";

export const durableSupportResource = defineResource({
  id: "durable",
  dependencies: { store: resources.store },
  init: async (_config, { store }) => {
    if (
      [...store.events.values()].some(
        ({ event }) =>
          durableEventTag.exists(event) &&
          durableEventTag.extract(event)?.enabled !== false,
      ) &&
      ![...store.resources.values()].some(({ resource }) =>
        isSameDefinition(resource, durableEventBridgeResource),
      )
    ) {
      durableExecutionInvariantError.throw({
        message:
          "Durable event tags require resources.durableEventBridge to be registered.",
      });
    }
  },
  register: [
    durableEventTag,
    durableRuntimeTag,
    durableWorkflowTag,
    ...durableEventsArray,
    durableShutdownAbortingHook,
  ],
  meta: {
    title: "Durable Support",
    description:
      "Registers durable workflow tags and durable runtime events for Node runtimes.",
  },
});
