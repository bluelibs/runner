import { defineResource } from "../../definers/defineResource";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import type { TaskRunner } from "../../models/TaskRunner";
import { globalTags } from "../globalTags";

export const taskRunnerResource = defineResource<void, Promise<TaskRunner>>(
  markFrameworkDefinition({
    id: "system.taskRunner",
    meta: {
      title: "Task Runner",
      description:
        "Manages the execution of tasks and task dependencies. This is meant to be used internally for most use-cases.",
    },
    tags: [globalTags.system],
  }),
);
