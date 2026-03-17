import { defineResource } from "../../../definers/defineResource";
import { durableEventsArray } from "../events";
import { durableWorkflowTag } from "../tags/durableWorkflow.tag";

export const durableSupportResource = defineResource({
  id: "durable",
  register: [durableWorkflowTag, ...durableEventsArray],
  meta: {
    title: "Durable Support",
    description:
      "Registers durable workflow tags and durable runtime events for Node runtimes.",
  },
});
