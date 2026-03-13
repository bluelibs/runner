import { defineResource } from "../../definers/defineResource";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import type { RunnerMode } from "../../types/runner";

/**
 * Resolved runtime mode exposed as a narrow read-only DI value.
 *
 * Preferred access: `resources.mode`.
 */
export const modeResource = defineResource<void, Promise<RunnerMode>>(
  markFrameworkDefinition({
    id: "runner.mode",
    meta: {
      title: "Runner Mode",
      description:
        "Resolved runtime mode for least-privilege environment-aware resource composition and initialization.",
    },
  }),
);
