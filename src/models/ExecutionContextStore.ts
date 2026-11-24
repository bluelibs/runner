import {
  genericError,
  executionCycleError,
  executionDepthExceededError,
} from "../errors";
import type { IAsyncLocalStorage } from "../platform";
import type {
  ExecutionFrame,
  ExecutionFrameKind,
  ExecutionContextFramesMode,
  ExecutionContextSnapshot,
  ExecutionContextConfig,
  CycleDetectionConfig,
} from "../types/executionContext";
import type { RuntimeCallSource } from "../types/runtimeSource";
import {
  type ActiveExecutionContext,
  createFallbackCorrelationId,
  createRecordNode,
  finishRecordNode,
  getCurrentExecutionContext,
  getExistingSharedExecutionContextStore,
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
    if (framesMode === "full" && this.cycleDetectionValue) {
      this.assertDepthLimit(currentDepth, frame);
      this.assertNoExcessiveRepetition(frame, currentContext);
    }

    const currentRecording = currentContext?.recording;
    const nextContext: ActiveExecutionContext = {
      correlationId:
        currentContext?.correlationId ?? this.createCorrelationIdValue(),
      startedAt: currentContext?.startedAt ?? frame.timestamp,
      signal: currentContext?.signal ?? options?.signal,
      framesMode,
      frameNode:
        framesMode === "full"
          ? {
              frame,
              kind: frame.kind,
              id: frame.id,
              parent: currentContext?.frameNode,
            }
          : undefined,
      depth: currentDepth + 1,
      recording: currentRecording,
    };

    if (!currentRecording) {
      return store.run(nextContext, fn);
    }
    const node = createRecordNode(currentRecording, frame);
    currentRecording.nodes.set(node.id, node);
    if (currentContext.frameNodeId) {
      currentRecording.nodes
        .get(currentContext.frameNodeId)
        ?.childIds.push(node.id);
    } else {
      currentRecording.rootIds.push(node.id);
    }
    const recordNodeId = node.id;
    const recordedContext: ActiveExecutionContext = {
      ...nextContext,
      frameNodeId: recordNodeId,
    };

    return store.run(recordedContext, () => {
      let isAsyncResult = false;

      try {
        const result = fn();
        if (isPromiseLike(result)) {
          isAsyncResult = true;
          return Promise.resolve(result)
            .catch((error) => {
              markRecordNodeFailed(currentRecording, recordNodeId, error);
              throw error;
            })
            .finally(() =>
              finishRecordNode(currentRecording, recordNodeId),
            ) as T;
        }

        return result;
      } catch (error) {
        markRecordNodeFailed(currentRecording, recordNodeId, error);
        throw error;
      } finally {
        if (!isAsyncResult) {
          finishRecordNode(currentRecording, recordNodeId);
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

  /** Runs a runtime operation without allocating a frame when tracking is off. */
  runInFrame<T>(
    kind: ExecutionFrameKind,
    id: string,
    source: RuntimeCallSource,
    fn: () => T,
    signal?: AbortSignal,
  ): T {
    if (!this.isEnabled) {
      return this.runWithoutContext(
        fn,
        getExistingSharedExecutionContextStore(),
      );
    }

    return this.runWithFrame({ kind, id, source, timestamp: Date.now() }, fn, {
      signal,
    });
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
    frame: ExecutionFrame,
    currentContext: ActiveExecutionContext | null | undefined,
  ): void {
    let repetitions = 1;
    for (let node = currentContext?.frameNode; node; node = node.parent) {
      if (node.kind === frame.kind && node.id === frame.id) {
        repetitions += 1;
      }
    }
    if (
      this.cycleDetectionValue &&
      repetitions >= this.cycleDetectionValue.maxRepetitions
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
        repetitions,
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
