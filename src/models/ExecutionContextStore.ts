import {
  genericError,
  executionCycleError,
  executionDepthExceededError,
} from "../errors";
import type { IAsyncLocalStorage } from "../platform";
import type {
  ExecutionFrame,
  ExecutionContextFramesMode,
  ExecutionContextSnapshot,
  ExecutionContextConfig,
  CycleDetectionConfig,
} from "../types/executionContext";
import {
  type ActiveExecutionContext,
  createFallbackCorrelationId,
  createRecordNode,
  finishRecordNode,
  getCurrentExecutionContext,
  getExistingSharedExecutionContextStore,
  getFrameKey,
  getSharedExecutionContextStore,
  isPromiseLike,
  markRecordNodeFailed,
  provideExecutionContext,
  recordExecutionContext,
  toSnapshot,
} from "./execution-context/recording";

export {
  getCurrentExecutionContext,
  provideExecutionContext,
  recordExecutionContext,
};

/**
 * Tracks the full causal chain of task calls, event emissions, and hook executions.
 * Uses AsyncLocalStorage. When ALS is unavailable, execution context is disabled.
 *
 * Replaces the former event-only CycleContext with a unified approach:
 * - Detects cycles via configurable repetition threshold (same kind+id appearing N times)
 * - Enforces a max depth hard stop
 * - Provides the full execution context for debugging and observability
 */
export class ExecutionContextStore {
  private isEnabledValue = false;
  private isCycleDetectionEnabledValue = false;
  private createCorrelationIdValue: () => string = createFallbackCorrelationId;
  private framesModeValue: ExecutionContextFramesMode = "full";
  private cycleDetectionValue: CycleDetectionConfig | null = null;

  constructor(config: ExecutionContextConfig | CycleDetectionConfig | null) {
    this.configure(config);
  }

  get isEnabled(): boolean {
    return this.isEnabledValue;
  }

  get isCycleDetectionEnabled(): boolean {
    return this.isCycleDetectionEnabledValue;
  }

  configure(
    config: ExecutionContextConfig | CycleDetectionConfig | null,
  ): void {
    if (config && getSharedExecutionContextStore()) {
      if ("createCorrelationId" in config) {
        this.createCorrelationIdValue = config.createCorrelationId;
        this.framesModeValue = config.frames;
        this.cycleDetectionValue = config.cycleDetection;
      } else {
        this.createCorrelationIdValue = createFallbackCorrelationId;
        this.framesModeValue = "full";
        this.cycleDetectionValue = {
          maxDepth: config.maxDepth,
          maxRepetitions: config.maxRepetitions,
        };
      }
      this.isEnabledValue = true;
      this.isCycleDetectionEnabledValue = this.cycleDetectionValue !== null;
    } else {
      this.createCorrelationIdValue = createFallbackCorrelationId;
      this.framesModeValue = "full";
      this.cycleDetectionValue = null;
      this.isEnabledValue = false;
      this.isCycleDetectionEnabledValue = false;
    }
  }

  /**
   * Executes `fn` with a new frame appended to the current execution branch.
   * Validates depth limit and repetition threshold before entering.
   */
  runWithFrame<T>(
    frame: ExecutionFrame,
    fn: () => T,
    options?: { signal?: AbortSignal },
  ): T {
    const store = getSharedExecutionContextStore();
    if (!this.isEnabled || !store) {
      return this.runWithoutContext(fn, store);
    }

    const currentContext = store.getStore();
    const framesMode = currentContext?.framesMode ?? this.framesModeValue;
    const currentDepth = currentContext?.depth ?? 0;
    const currentRepetitions =
      framesMode === "full"
        ? (currentContext?.frameCounts?.get(getFrameKey(frame)) ?? 0)
        : 0;

    if (framesMode === "full" && this.cycleDetectionValue) {
      this.assertDepthLimit(currentDepth, frame);
      this.assertNoExcessiveRepetition(
        currentRepetitions,
        frame,
        currentContext,
      );
    }

    const currentRecording = currentContext?.recording;
    let frameNodeId: string | undefined;
    if (currentRecording) {
      const node = createRecordNode(currentRecording, frame);
      currentRecording.nodes.set(node.id, node);
      if (currentContext?.frameNodeId) {
        currentRecording.nodes
          .get(currentContext.frameNodeId)
          ?.childIds.push(node.id);
      } else {
        currentRecording.rootIds.push(node.id);
      }
      frameNodeId = node.id;
    }
    const nextFrameCounts =
      framesMode === "full" ? new Map(currentContext?.frameCounts) : undefined;
    if (framesMode === "full") {
      nextFrameCounts!.set(getFrameKey(frame), currentRepetitions + 1);
    }
    const nextContext = currentContext
      ? {
          correlationId: currentContext.correlationId,
          startedAt: currentContext.startedAt,
          signal: currentContext.signal ?? options?.signal,
          framesMode,
          frameNode:
            framesMode === "full"
              ? {
                  frame,
                  parent: currentContext.frameNode,
                }
              : undefined,
          depth: currentDepth + 1,
          frameCounts: nextFrameCounts,
          frameNodeId: framesMode === "full" ? frameNodeId : undefined,
          recording: currentRecording,
        }
      : {
          correlationId: this.createCorrelationIdValue(),
          startedAt: frame.timestamp,
          signal: options?.signal,
          framesMode,
          frameNode:
            framesMode === "full"
              ? {
                  frame,
                  parent: undefined,
                }
              : undefined,
          depth: 1,
          frameCounts: nextFrameCounts,
          frameNodeId: undefined,
          recording: undefined,
        };

    return store.run(nextContext, () => {
      const markFailed = (error: unknown) => {
        if (currentRecording && frameNodeId) {
          markRecordNodeFailed(currentRecording, frameNodeId, error);
        }
      };
      let isAsyncResult = false;

      try {
        const result = fn();
        if (isPromiseLike(result)) {
          isAsyncResult = true;
          return Promise.resolve(result)
            .catch((error) => {
              markFailed(error);
              throw error;
            })
            .finally(() => {
              if (currentRecording && frameNodeId) {
                finishRecordNode(currentRecording, frameNodeId);
              }
            }) as T;
        }

        return result;
      } catch (error) {
        markFailed(error);
        throw error;
      } finally {
        if (!isAsyncResult && currentRecording && frameNodeId) {
          finishRecordNode(currentRecording, frameNodeId);
        }
      }
    });
  }

  /**
   * Executes `fn` with a lazily-created execution frame.
   *
   * Frame creation can be surprisingly visible in the hot path because it usually
   * includes timestamp allocation. Keeping it lazy lets disabled execution
   * context stay close to a direct function call while preserving the same
   * semantics whenever context tracking is enabled.
   */
  runWithFrameFactory<T>(
    createFrame: () => ExecutionFrame,
    fn: () => T,
    options?: { signal?: AbortSignal },
  ): T {
    if (!this.isEnabled) {
      return this.runWithoutContext(
        fn,
        getExistingSharedExecutionContextStore(),
      );
    }

    const store = getSharedExecutionContextStore();
    if (!store) {
      return this.runWithoutContext(fn, store);
    }

    return this.runWithFrame(createFrame(), fn, options);
  }

  /**
   * Seeds the current execution tree with its first inherited signal.
   *
   * This is narrower than `runWithFrame(...)`: it only fills the ambient
   * signal slot when execution context is enabled, a frame is already active,
   * and no signal has been inherited yet.
   */
  runWithSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
    if (!this.isEnabled) {
      return this.runWithoutContext(
        fn,
        getExistingSharedExecutionContextStore(),
      );
    }

    const store = getSharedExecutionContextStore();
    if (!store) {
      return this.runWithoutContext(fn, store);
    }

    const currentContext = store.getStore();
    if (!currentContext || currentContext.signal || !signal) {
      return fn();
    }

    return store.run(
      {
        ...currentContext,
        signal,
      },
      fn,
    );
  }

  /**
   * Resolves the effective signal for a call.
   *
   * When execution context is enabled, omitted signals inherit the first
   * ambient signal already attached to the current execution tree.
   */
  resolveSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
    if (signal || !this.isEnabled) {
      return signal;
    }

    return getSharedExecutionContextStore()?.getStore()?.signal;
  }

  /**
   * Returns the current execution snapshot, or undefined if execution context
   * is disabled or no execution is active.
   */
  getSnapshot(): ExecutionContextSnapshot | undefined {
    return getCurrentExecutionContext();
  }

  private assertDepthLimit(currentDepth: number, frame: ExecutionFrame): void {
    if (
      this.cycleDetectionValue &&
      currentDepth >= this.cycleDetectionValue.maxDepth
    ) {
      executionDepthExceededError.throw({
        frame,
        currentDepth,
        maxDepth: this.cycleDetectionValue.maxDepth,
      });
    }
  }

  private assertNoExcessiveRepetition(
    currentRepetitions: number,
    frame: ExecutionFrame,
    currentContext: ActiveExecutionContext | null | undefined,
  ): void {
    const nextRepetitions = currentRepetitions + 1;
    if (
      this.cycleDetectionValue &&
      nextRepetitions >= this.cycleDetectionValue.maxRepetitions
    ) {
      const traceSnapshot = toSnapshot(currentContext);
      /* istanbul ignore next -- cycle detection only runs with full frame tracking */
      if (!traceSnapshot || traceSnapshot.framesMode !== "full") {
        throw genericError.new({
          message: "Execution cycle detection requires full frame tracking.",
        });
      }
      executionCycleError.throw({
        frame,
        repetitions: nextRepetitions,
        maxRepetitions: this.cycleDetectionValue.maxRepetitions,
        trace: traceSnapshot.frames,
      });
    }
  }

  private runWithoutContext<T>(
    fn: () => T,
    store: IAsyncLocalStorage<ActiveExecutionContext | null> | null,
  ): T {
    if (!store) return fn();

    const current = store.getStore();
    if (current === undefined) {
      return fn();
    }

    return store.run(null, fn);
  }
}
