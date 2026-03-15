import type {
  CycleDetectionConfig,
  ExecutionContextConfig,
  ExecutionContextFramesMode,
  ExecutionContextOptions,
} from "../types/executionContext";
import { EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS } from "../types/executionContext";
import { Match, check } from "./check/engine";

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

function resolveFramesMode(
  frames: ExecutionContextFramesMode | undefined,
): ExecutionContextFramesMode {
  return frames ?? "full";
}

export function resolveExecutionContextConfig(
  executionContext: boolean | ExecutionContextOptions | undefined,
): ExecutionContextConfig | null {
  if (executionContext === false || executionContext === undefined) {
    return null;
  }

  if (executionContext === true) {
    return {
      createCorrelationId: createDefaultCorrelationId,
      frames: "full",
      cycleDetection: { ...EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS },
    };
  }

  const config = {
    createCorrelationId:
      executionContext.createCorrelationId ?? createDefaultCorrelationId,
    frames: resolveFramesMode(executionContext.frames),
    cycleDetection: resolveCycleDetection(executionContext.cycleDetection),
  };

  check(
    config,
    Match.WithMessage(
      Match.OneOf(
        Match.ObjectIncluding({ frames: "full" }),
        Match.ObjectIncluding({ frames: "off", cycleDetection: null }),
      ),
      'executionContext.frames "off" requires cycleDetection: false.',
    ),
  );

  return config;
}
