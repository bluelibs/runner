import { defineTag } from "../../../definers/defineTag";
import { genericError } from "../../../errors";
import { Match } from "../../../tools/check";
import type { IEventDefinition } from "../../../types/event";
import type { AnyTask } from "../../../types/task";

export type DurableWorkflowSignalDefinition = Pick<
  IEventDefinition<unknown>,
  "id"
>;

/** Fixed-window admission policy for durable workflow attempts. */
export interface DurableWorkflowRateLimit {
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Maximum workflow attempts admitted during one window. */
  max: number;
}

/** Global admission policy shared by every worker using the durable store. */
export type DurableWorkflowConcurrency = number | DurableWorkflowRateLimit;

export interface DurableWorkflowTagConfig {
  /**
   * Optional stable durable workflow key persisted across refactors.
   * When omitted, durable falls back to the canonical runtime task id.
   */
  key?: string;
  /**
   * Optional domain/category to group workflows (eg. "orders", "billing").
   */
  category?: string;
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
  /**
   * Optional global attempt admission policy.
   *
   * A number caps simultaneously running attempts. A fixed-window object caps
   * attempt admissions during each window. Both policies coordinate through
   * the durable store, so the limit is shared across workers.
   */
  concurrency?: DurableWorkflowConcurrency;
}

const positiveInteger = Match.Range({ min: 1, integer: true });

const durableWorkflowConfigPattern = Match.compile({
  key: Match.Optional(Match.NonEmptyString),
  category: Match.Optional(String),
  metadata: Match.Optional(Object),
  signals: Match.Optional(
    Match.ArrayOf(Match.ObjectIncluding({ id: Match.NonEmptyString })),
  ),
  concurrency: Match.Optional(
    Match.OneOf(positiveInteger, {
      windowMs: positiveInteger,
      max: positiveInteger,
    }),
  ),
});

const durableWorkflowConfigSchema = {
  parse(input: unknown): DurableWorkflowTagConfig {
    const config = durableWorkflowConfigPattern.parse(input);
    const signalIds = config.signals?.map((signal) => signal.id) ?? [];
    const uniqueSignalIds = new Set(signalIds);

    if (uniqueSignalIds.size !== signalIds.length) {
      throw genericError.new({
        message:
          "durableWorkflow.signals must contain unique local signal ids.",
      });
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

export function getDurableWorkflowKey(
  task: Pick<AnyTask, "id" | "tags"> | undefined,
  canonicalTaskId?: string,
): string | undefined {
  if (!task) return canonicalTaskId;
  const config = durableWorkflowTag.extract(task.tags ?? []);
  return config?.key ?? canonicalTaskId ?? task.id;
}

/** Returns the workflow's global attempt-admission policy, when configured. */
export function getDurableWorkflowConcurrency(
  task: Pick<AnyTask, "id" | "tags"> | undefined,
): DurableWorkflowConcurrency | undefined {
  if (!task) return undefined;
  return durableWorkflowTag.extract(task.tags ?? [])?.concurrency;
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
