import { defineResource } from "../../definers/defineResource";
import type { TaskRunner } from "../../models/TaskRunner";

export const taskRunnerResource = defineResource<void, Promise<TaskRunner>>({
  id: "taskRunner",
  meta: {
    title: "Task Runner",
    description:
      "Manages the execution of tasks and task dependencies. This is meant to be used internally for most use-cases.",
  },
});
