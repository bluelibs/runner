import { defineTag } from "../../../define";

export interface DurableWorkflowTagConfig {
  /**
   * Optional domain/category to group workflows (eg. "orders", "billing").
   */
  category?: string;
  /**
   * Optional default input used by `durable.describe(task)` when no explicit
   * input argument is provided.
   */
  defaults?: Record<string, unknown>;
  /**
   * Optional metadata for dashboards/tooling.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Marks a task as a durable workflow for runtime discovery.
 */
export const durableWorkflowTag = defineTag<DurableWorkflowTagConfig>({
  id: "globals.tags.durableWorkflow",
  meta: {
    title: "Durable Workflow",
    description:
      "Marks tasks intended to run as durable workflows so they can be discovered at runtime.",
  },
});
