import { defineResource } from "../../definers/defineResource";
import { globalTags } from "../globalTags";
import type { ExecutionContextOptions } from "../../types/executionContext";
import { Match } from "../../tools/check";
import type { ExecutionContextStore } from "../../models/ExecutionContextStore";

const executionContextConfigPattern = Match.ObjectIncluding({
  createCorrelationId: Match.Optional(Function),
  frames: Match.Optional(Match.OneOf("full", "off")),
  cycleDetection: Match.Optional(
    Match.OneOf(
      false,
      Match.ObjectIncluding({
        maxDepth: Match.Optional(Match.Integer),
        maxRepetitions: Match.Optional(Match.Integer),
      }),
    ),
  ),
});

/**
 * Opt-in execution tracing resource.
 *
 * Register this resource to enable `asyncContexts.execution` for runtime task
 * runs and event emissions. Customize behavior with
 * `resources.executionContext.with({ ... })`.
 */
export const executionContextResource = defineResource<
  ExecutionContextOptions,
  Promise<ExecutionContextStore>
>({
  id: "executionContext",
  configSchema: executionContextConfigPattern,
  meta: {
    title: "Execution Context",
    description:
      "Opt-in execution tracing store that powers correlation ids, causal-chain snapshots, and runtime cycle detection.",
  },
  tags: [globalTags.system],
});
