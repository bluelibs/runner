import { defineResource } from "../../../definers/defineResource";
import { markFrameworkDefinition } from "../../../definers/markFrameworkDefinition";
import { globalTags } from "../../../globals/globalTags";
import { durableEventsArray } from "../events";
import { durableWorkflowTag } from "../tags/durableWorkflow.tag";

export const durableSupportResource = defineResource(
  markFrameworkDefinition({
    id: "runner.resources.durable",
    register: [durableWorkflowTag, ...durableEventsArray],
    tags: [globalTags.system],
    meta: {
      title: "Durable Support",
      description:
        "Registers durable workflow tags and durable runtime events for Node runtimes.",
    },
  }),
);
