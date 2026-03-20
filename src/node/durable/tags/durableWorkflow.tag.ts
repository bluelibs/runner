import { defineTag } from "../../../definers/defineTag";
import { Match } from "../../../tools/check";
import type { IEventDefinition } from "../../../types/event";
import type { AnyTask } from "../../../types/task";

export type DurableWorkflowSignalDefinition = Pick<
  IEventDefinition<unknown>,
  "id"
>;

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
  /**
   * Optional durable signal contract. When omitted, any signal is allowed for
   * backwards compatibility. When provided, only these local signal ids may be
   * used by the workflow.
   */
  signals?: DurableWorkflowSignalDefinition[];
}

const durableWorkflowConfigPattern = Match.compile({
  category: Match.Optional(String),
  defaults: Match.Optional(Object),
  metadata: Match.Optional(Object),
  signals: Match.Optional(
    Match.ArrayOf(Match.ObjectIncluding({ id: Match.NonEmptyString })),
  ),
});

const durableWorkflowConfigSchema = {
  parse(input: unknown): DurableWorkflowTagConfig {
    const config = durableWorkflowConfigPattern.parse(input);
    const signalIds = config.signals?.map((signal) => signal.id) ?? [];
    const uniqueSignalIds = new Set(signalIds);

    if (uniqueSignalIds.size !== signalIds.length) {
      throw new Error(
        "durableWorkflow.signals must contain unique local signal ids.",
      );
    }

    return config;
  },
};

export function getDeclaredDurableWorkflowSignalIds(
  task: Pick<AnyTask, "id" | "tags"> | undefined,
): ReadonlySet<string> | null {
  if (!task) return null;
  const config = durableWorkflowTag.extract(task.tags ?? []);
  if (!config?.signals) return null;

  return new Set(config.signals.map((signal) => signal.id));
}

/**
 * Marks a task as a durable workflow for runtime discovery.
 */
export const durableWorkflowTag = defineTag<DurableWorkflowTagConfig>({
  id: "durableWorkflow",
  configSchema: durableWorkflowConfigSchema,
  meta: {
    title: "Durable Workflow",
    description:
      "Marks tasks intended to run as durable workflows so they can be discovered at runtime.",
  },
});
