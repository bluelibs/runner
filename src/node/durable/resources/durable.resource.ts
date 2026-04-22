import { defineResource } from "../../../definers/defineResource";
import { durableEventsArray } from "../events";
import { durableRuntimeTag } from "../tags/durableRuntime.tag";
import { durableWorkflowTag } from "../tags/durableWorkflow.tag";
import { durableShutdownAbortingHook } from "./durableShutdownAborting.hook";

export const durableSupportResource = defineResource({
  id: "durable",
  register: [
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
