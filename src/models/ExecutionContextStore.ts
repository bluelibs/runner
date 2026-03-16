import {
  genericError,
  contextError,
  executionCycleError,
  executionDepthExceededError,
} from "../errors";
import { getPlatform, IAsyncLocalStorage } from "../platform";
import type {
  ExecutionFrame,
  ExecutionRecordNode,
  ExecutionRecordResult,
  ExecutionRecordSnapshot,
  ExecutionContextFramesMode,
  ExecutionContextSnapshot,
  ExecutionContextConfig,
  CycleDetectionConfig,
  ExecutionContextProvideOptions,
} from "../types/executionContext";

type ActiveExecutionRecordNode = {
  readonly id: string;
  readonly frame: ExecutionFrame;
  readonly startedAt: number;
  endedAt: number | undefined;
  status: "running" | "completed" | "failed";
  error: unknown;
  readonly childIds: string[];
};

type ActiveExecutionRecording = {
  readonly correlationId: string;
  readonly startedAt: number;
  sequence: number;
  readonly rootIds: string[];
  readonly nodes: Map<string, ActiveExecutionRecordNode>;
};

type ActiveFrameNode = {
  readonly frame: ExecutionFrame;
  readonly parent: ActiveFrameNode | undefined;
};

type ActiveExecutionContext = {
  readonly correlationId: string;
  readonly startedAt: number;
  readonly signal?: AbortSignal;
  readonly framesMode: ExecutionContextFramesMode;
  readonly frameNode: ActiveFrameNode | undefined;
  readonly depth: number;
  readonly frameCounts?: ReadonlyMap<string, number>;
  readonly frameNodeId?: string;
  readonly recording?: ActiveExecutionRecording;
};

let sharedStore: IAsyncLocalStorage<ActiveExecutionContext | null> | undefined;
let sharedStorePlatform: ReturnType<typeof getPlatform> | undefined;

function getSharedExecutionContextStore(): IAsyncLocalStorage<ActiveExecutionContext | null> | null {
  const platform = getPlatform();
  if (sharedStorePlatform !== platform) {
    sharedStorePlatform = platform;
    sharedStore = undefined;
  }

  if (sharedStore) {
    return sharedStore;
  }

  if (!platform.hasAsyncLocalStorage()) {
    return null;
  }

  sharedStore =
    platform.createAsyncLocalStorage<ActiveExecutionContext | null>();
  return sharedStore;
}

function toSnapshot(
  value: ActiveExecutionContext | null | undefined,
): ExecutionContextSnapshot | undefined {
  if (!value || value.depth === 0) return undefined;

  if (value.framesMode === "off") {
    return {
      correlationId: value.correlationId,
      startedAt: value.startedAt,
      signal: value.signal,
      framesMode: "off",
    };
  }

  /* istanbul ignore next -- full mode with positive depth but no frame node is impossible unless internal state is manually corrupted */
  if (!value.frameNode) return undefined;

  const frames = new Array<ExecutionFrame>(value.depth);
  let currentNode: ActiveFrameNode | undefined = value.frameNode;
  for (let index = value.depth - 1; index >= 0; index -= 1) {
    frames[index] = currentNode!.frame;
    currentNode = currentNode!.parent;
  }

  return {
    correlationId: value.correlationId,
    startedAt: value.startedAt,
    signal: value.signal,
    framesMode: "full",
    frames,
    depth: value.depth,
    currentFrame: value.frameNode.frame,
  };
}

function createFallbackCorrelationId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getCurrentExecutionContext():
  | ExecutionContextSnapshot
  | undefined {
  return toSnapshot(getSharedExecutionContextStore()?.getStore());
}

function createProvidedContext(
  current: ActiveExecutionContext | null | undefined,
  defaultFramesMode: ExecutionContextFramesMode,
  options?: ExecutionContextProvideOptions,
): ActiveExecutionContext {
  return {
    correlationId:
      current?.correlationId ??
      options?.correlationId ??
      createFallbackCorrelationId(),
    startedAt: current?.startedAt ?? Date.now(),
    signal: current?.signal ?? options?.signal,
    framesMode: current?.framesMode ?? defaultFramesMode,
    frameNode: current?.frameNode,
    depth: current?.depth ?? 0,
    frameCounts:
      current?.frameCounts ??
      (current?.framesMode === "off" || defaultFramesMode === "off"
        ? undefined
        : new Map()),
    frameNodeId: current?.frameNodeId,
    recording: current?.recording,
  };
}

function promoteContextForRecording(
  current: ActiveExecutionContext,
  recording: ActiveExecutionRecording,
): ActiveExecutionContext {
  if (current.recording) {
    return {
      ...current,
      recording,
    };
  }

  return {
    correlationId: current.correlationId,
    startedAt: current.startedAt,
    signal: current.signal,
    framesMode: "full",
    frameNode: undefined,
    depth: 0,
    frameCounts: new Map(),
    frameNodeId: undefined,
    recording,
  };
}

function createExecutionRecording(
  correlationId: string,
  startedAt: number,
): ActiveExecutionRecording {
  return {
    correlationId,
    startedAt,
    sequence: 0,
    rootIds: [],
    nodes: new Map(),
  };
}

function createRecordNode(
  recording: ActiveExecutionRecording,
  frame: ExecutionFrame,
): ActiveExecutionRecordNode {
  recording.sequence += 1;
  return {
    id: `node-${recording.sequence}`,
    frame,
    startedAt: frame.timestamp,
    endedAt: undefined,
    status: "running",
    error: undefined,
    childIds: [],
  };
}

function toRecordTreeNode(
  nodeId: string,
  nodes: ReadonlyMap<string, ActiveExecutionRecordNode>,
): ExecutionRecordNode {
  const node = nodes.get(nodeId);
  /* istanbul ignore next -- tree corruption is impossible unless internal state is manually mutated */
  if (!node) {
    throw genericError.new({
      message: `Execution record node "${nodeId}" is missing.`,
    });
  }

  return {
    id: node.id,
    frame: node.frame,
    startedAt: node.startedAt,
    endedAt: node.endedAt,
    status: node.status,
    error: node.error,
    children: node.childIds.map((childId) => toRecordTreeNode(childId, nodes)),
  };
}

function toRecordingSnapshot(
  recording: ActiveExecutionRecording | undefined,
): ExecutionRecordSnapshot | undefined {
  if (!recording || recording.rootIds.length === 0) {
    return undefined;
  }

  const finishedAt = Array.from(recording.nodes.values()).reduce(
    (latest, node) => Math.max(latest, node.endedAt ?? node.startedAt),
    recording.startedAt,
  );

  return {
    correlationId: recording.correlationId,
    startedAt: recording.startedAt,
    finishedAt,
    roots: recording.rootIds.map((rootId) =>
      toRecordTreeNode(rootId, recording.nodes),
    ),
  };
}

function isPromiseLike<T>(value: T): value is T & PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function getFrameKey(frame: ExecutionFrame): string {
  return `${frame.kind}:${frame.id}`;
}

export function provideExecutionContext<T>(
  options: ExecutionContextProvideOptions | undefined,
  fn: () => T,
): T {
  const executionStore = getSharedExecutionContextStore();
  if (!executionStore) {
    throw contextError.new({
      details:
        "Execution context propagation requires AsyncLocalStorage and is not available in this environment.",
    });
  }

  return executionStore.run(
    createProvidedContext(executionStore.getStore(), "full", options),
    fn,
  );
}

export async function recordExecutionContext<T>(
  options: ExecutionContextProvideOptions | undefined,
  fn: () => T,
): Promise<ExecutionRecordResult<Awaited<T>>> {
  const executionStore = getSharedExecutionContextStore();
  if (!executionStore) {
    throw contextError.new({
      details:
        "Execution context propagation requires AsyncLocalStorage and is not available in this environment.",
    });
  }

  const currentContext = executionStore.getStore();
  const baseContext = createProvidedContext(currentContext, "full", options);
  const recording =
    baseContext.recording ??
    createExecutionRecording(baseContext.correlationId, baseContext.startedAt);
  const result = await executionStore.run(
    currentContext
      ? promoteContextForRecording(baseContext, recording)
      : {
          ...baseContext,
          recording,
          framesMode: "full",
          frameCounts: new Map(),
        },
    fn,
  );

  return {
    result: result as Awaited<T>,
    recording: toRecordingSnapshot(recording),
  };
}

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
          frameNodeId: framesMode === "full" ? undefined : undefined,
          recording: undefined,
        };

    return store.run(nextContext, () => {
      const markFailed = (error: unknown) => {
        if (currentRecording && frameNodeId) {
          const node = currentRecording.nodes.get(frameNodeId)!;
          node.endedAt = Date.now();
          node.status = "failed";
          node.error = error;
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
                const node = currentRecording.nodes.get(frameNodeId)!;
                node.endedAt ??= Date.now();
                if (node.status === "running") {
                  node.status = "completed";
                }
              }
            }) as T;
        }

        return result;
      } catch (error) {
        markFailed(error);
        throw error;
      } finally {
        if (!isAsyncResult && currentRecording && frameNodeId) {
          const node = currentRecording.nodes.get(frameNodeId)!;
          node.endedAt ??= Date.now();
          if (node.status === "running") {
            node.status = "completed";
          }
        }
      }
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
    const store = getSharedExecutionContextStore();
    if (!this.isEnabled || !store) {
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
