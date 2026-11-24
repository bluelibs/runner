import { contextError, genericError } from "../../errors";
import { getPlatform, IAsyncLocalStorage } from "../../platform";
import type {
  ExecutionContextFramesMode,
  ExecutionContextProvideOptions,
  ExecutionContextSnapshot,
  ExecutionFrame,
  ExecutionRecordNode,
  ExecutionRecordResult,
  ExecutionRecordSnapshot,
} from "../../types/executionContext";

export type ActiveExecutionRecordNode = {
  readonly id: string;
  readonly frame: ExecutionFrame;
  readonly startedAt: number;
  endedAt: number | undefined;
  status: "running" | "completed" | "failed";
  error: unknown;
  readonly childIds: string[];
};

export type ActiveExecutionRecording = {
  readonly correlationId: string;
  readonly startedAt: number;
  sequence: number;
  readonly rootIds: string[];
  readonly nodes: Map<string, ActiveExecutionRecordNode>;
};

export type ActiveFrameNode = {
  readonly frame: ExecutionFrame;
  readonly parent: ActiveFrameNode | undefined;
};

export type ActiveExecutionContext = {
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

export function getSharedExecutionContextStore(): IAsyncLocalStorage<ActiveExecutionContext | null> | null {
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

export function getExistingSharedExecutionContextStore(): IAsyncLocalStorage<ActiveExecutionContext | null> | null {
  if (!sharedStore) {
    return null;
  }

  const platform = getPlatform();
  if (sharedStorePlatform !== platform) {
    sharedStorePlatform = platform;
    sharedStore = undefined;
    return null;
  }

  return sharedStore;
}

export function toSnapshot(
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

export function createFallbackCorrelationId(): string {
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

export function createRecordNode(
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

export function markRecordNodeFailed(
  recording: ActiveExecutionRecording,
  frameNodeId: string,
  error: unknown,
): void {
  const node = recording.nodes.get(frameNodeId)!;
  node.endedAt = Date.now();
  node.status = "failed";
  node.error = error;
}

export function finishRecordNode(
  recording: ActiveExecutionRecording,
  frameNodeId: string,
): void {
  const node = recording.nodes.get(frameNodeId)!;
  node.endedAt ??= Date.now();
  if (node.status === "running") {
    node.status = "completed";
  }
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

export function isPromiseLike<T>(value: T): value is T & PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

export function getFrameKey(frame: ExecutionFrame): string {
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
