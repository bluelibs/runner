import {
  createMessageError,
  executionCycleError,
  executionDepthExceededError,
} from "../errors";
import { getPlatform, IAsyncLocalStorage } from "../platform";
import type {
  ExecutionFrame,
  ExecutionRecordNode,
  ExecutionRecordResult,
  ExecutionRecordSnapshot,
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
  readonly frameNode: ActiveFrameNode | undefined;
  readonly depth: number;
  readonly frameCounts: ReadonlyMap<string, number>;
  readonly frameNodeId?: string;
  readonly recording?: ActiveExecutionRecording;
};

let sharedStore:
  | IAsyncLocalStorage<ActiveExecutionContext | null>
  | null
  | undefined;
let sharedStorePlatform: ReturnType<typeof getPlatform> | undefined;

function getSharedExecutionContextStore(): IAsyncLocalStorage<ActiveExecutionContext | null> | null {
  const platform = getPlatform();
  if (sharedStorePlatform !== platform) {
    sharedStorePlatform = platform;
    sharedStore = platform.hasAsyncLocalStorage()
      ? platform.createAsyncLocalStorage<ActiveExecutionContext | null>()
      : null;
  }

  return sharedStore ?? null;
}

function toSnapshot(
  value: ActiveExecutionContext | null | undefined,
): ExecutionContextSnapshot | undefined {
  if (!value || !value.frameNode) return undefined;

  const frames = new Array<ExecutionFrame>(value.depth);
  let currentNode: ActiveFrameNode | undefined = value.frameNode;
  for (let index = value.depth - 1; index >= 0; index -= 1) {
    frames[index] = currentNode!.frame;
    currentNode = currentNode!.parent;
  }

  return {
    correlationId: value.correlationId,
    startedAt: value.startedAt,
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
  options?: ExecutionContextProvideOptions,
): ActiveExecutionContext {
  return {
    correlationId:
      current?.correlationId ??
      options?.correlationId ??
      createFallbackCorrelationId(),
    startedAt: current?.startedAt ?? Date.now(),
    frameNode: current?.frameNode,
    depth: current?.depth ?? 0,
    frameCounts: current?.frameCounts ?? new Map(),
    frameNodeId: current?.frameNodeId,
    recording: current?.recording,
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
    throw createMessageError(`Execution record node "${nodeId}" is missing.`);
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
  const store = getSharedExecutionContextStore();
  if (!store) {
    return fn();
  }

  return store.run(createProvidedContext(store.getStore(), options), fn);
}

export async function recordExecutionContext<T>(
  options: ExecutionContextProvideOptions | undefined,
  fn: () => T,
): Promise<ExecutionRecordResult<Awaited<T>>> {
  const store = getSharedExecutionContextStore();
  if (!store) {
    return {
      result: (await fn()) as Awaited<T>,
      recording: undefined,
    };
  }

  const baseContext = createProvidedContext(store.getStore(), options);
  const recording =
    baseContext.recording ??
    createExecutionRecording(baseContext.correlationId, baseContext.startedAt);
  const result = await store.run(
    {
      ...baseContext,
      recording,
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
 * Uses AsyncLocalStorage (Node-only). When ALS is unavailable, execution context is disabled.
 *
 * Replaces the former event-only CycleContext with a unified approach:
 * - Detects cycles via configurable repetition threshold (same kind+id appearing N times)
 * - Enforces a max depth hard stop
 * - Provides the full execution context for debugging and observability
 */
export class ExecutionContextStore {
  readonly isEnabled: boolean;
  readonly isCycleDetectionEnabled: boolean;
  private readonly createCorrelationId: () => string;
  private readonly cycleDetection: CycleDetectionConfig | null;

  constructor(config: ExecutionContextConfig | CycleDetectionConfig | null) {
    if (config && getSharedExecutionContextStore()) {
      if ("createCorrelationId" in config) {
        this.createCorrelationId = config.createCorrelationId;
        this.cycleDetection = config.cycleDetection;
      } else {
        this.createCorrelationId = createFallbackCorrelationId;
        this.cycleDetection = {
          maxDepth: config.maxDepth,
          maxRepetitions: config.maxRepetitions,
        };
      }
      this.isEnabled = true;
      this.isCycleDetectionEnabled = this.cycleDetection !== null;
    } else {
      this.createCorrelationId = createFallbackCorrelationId;
      this.cycleDetection = null;
      this.isEnabled = false;
      this.isCycleDetectionEnabled = false;
    }
  }

  /**
   * Executes `fn` with a new frame appended to the current execution branch.
   * Validates depth limit and repetition threshold before entering.
   */
  runWithFrame<T>(frame: ExecutionFrame, fn: () => T): T {
    const store = getSharedExecutionContextStore();
    if (!this.isEnabled || !store) {
      return this.runWithoutContext(fn, store);
    }

    const currentContext = store.getStore();
    const currentDepth = currentContext?.depth ?? 0;
    const currentRepetitions =
      currentContext?.frameCounts.get(getFrameKey(frame)) ?? 0;

    if (this.cycleDetection) {
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
    const nextFrameCounts = new Map(currentContext?.frameCounts);
    nextFrameCounts.set(getFrameKey(frame), currentRepetitions + 1);
    const nextContext = currentContext
      ? {
          correlationId: currentContext.correlationId,
          startedAt: currentContext.startedAt,
          frameNode: {
            frame,
            parent: currentContext.frameNode,
          },
          depth: currentDepth + 1,
          frameCounts: nextFrameCounts,
          frameNodeId,
          recording: currentRecording,
        }
      : {
          correlationId: this.createCorrelationId(),
          startedAt: frame.timestamp,
          frameNode: {
            frame,
            parent: undefined,
          },
          depth: 1,
          frameCounts: nextFrameCounts,
          frameNodeId: undefined,
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
   * Returns the current execution snapshot, or undefined if execution context
   * is disabled or no execution is active.
   */
  getSnapshot(): ExecutionContextSnapshot | undefined {
    return getCurrentExecutionContext();
  }

  private assertDepthLimit(currentDepth: number, frame: ExecutionFrame): void {
    if (this.cycleDetection && currentDepth >= this.cycleDetection.maxDepth) {
      executionDepthExceededError.throw({
        frame,
        currentDepth,
        maxDepth: this.cycleDetection.maxDepth,
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
      this.cycleDetection &&
      nextRepetitions >= this.cycleDetection.maxRepetitions
    ) {
      executionCycleError.throw({
        frame,
        repetitions: nextRepetitions,
        maxRepetitions: this.cycleDetection.maxRepetitions,
        trace: toSnapshot(currentContext)!.frames,
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
