import type {
  CycleDetectionConfig,
  ExecutionContextConfig,
  ExecutionContextOptions,
} from "../types/executionContext";
import { EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS } from "../types/executionContext";

function createDefaultCorrelationId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveCycleDetection(
  cycleDetection:
    | boolean
    | {
        maxDepth?: number;
        maxRepetitions?: number;
      }
    | undefined,
): CycleDetectionConfig | null {
  if (cycleDetection === false) return null;
  if (cycleDetection === undefined || cycleDetection === true) {
    return { ...EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS };
  }

  return {
    maxDepth:
      cycleDetection.maxDepth ??
      EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS.maxDepth,
    maxRepetitions:
      cycleDetection.maxRepetitions ??
      EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS.maxRepetitions,
  };
}

export function resolveExecutionContextConfig(
  executionContext: boolean | ExecutionContextOptions | undefined,
): ExecutionContextConfig | null {
  if (executionContext === false) return null;

  if (executionContext === true) {
    return {
      createCorrelationId: createDefaultCorrelationId,
      cycleDetection: { ...EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS },
    };
  }

  if (typeof executionContext === "object") {
    return {
      createCorrelationId:
        executionContext.createCorrelationId ?? createDefaultCorrelationId,
      cycleDetection: resolveCycleDetection(executionContext.cycleDetection),
    };
  }

  return null;
}
