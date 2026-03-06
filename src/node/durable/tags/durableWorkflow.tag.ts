import { defineFrameworkTag } from "../../../definers/frameworkDefinition";
import { Match } from "../../../tools/check";

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

const durableWorkflowConfigPattern = Match.ObjectIncluding({
  category: Match.Optional(String),
  defaults: Match.Optional(Object),
  metadata: Match.Optional(Object),
});

/**
 * Marks a task as a durable workflow for runtime discovery.
 */
export const durableWorkflowTag = defineFrameworkTag<DurableWorkflowTagConfig>({
  id: "runner.tags.durableWorkflow",
  configSchema: durableWorkflowConfigPattern,
  meta: {
    title: "Durable Workflow",
    description:
      "Marks tasks intended to run as durable workflows so they can be discovered at runtime.",
  },
});
