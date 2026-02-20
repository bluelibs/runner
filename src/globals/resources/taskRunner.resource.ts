import { defineResource } from "../../define";
import type { TaskRunner } from "../../models/TaskRunner";
import { globalTags } from "../globalTags";

export const taskRunnerResource = defineResource<void, Promise<TaskRunner>>({
  id: "globals.resources.taskRunner",
  meta: {
    title: "Task Runner",
    description:
      "Manages the execution of tasks and task dependencies. This is meant to be used internally for most use-cases.",
  },
  tags: [globalTags.system],
});
