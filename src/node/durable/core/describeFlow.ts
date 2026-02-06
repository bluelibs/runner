import type { IEventDefinition } from "../../../types/event";
import type { ITask } from "../../../types/task";
import { symbolTask } from "../../../types/symbols";
import type {
  IDurableContext,
  SwitchBranch,
  SleepOptions,
  SignalOptions,
  EmitOptions,
  StepOptions,
  IStepBuilder,
} from "./interfaces/context";
import type { DurableStepId } from "./ids";

// ─── Flow shape types ────────────────────────────────────────────────────

/** Discriminated union describing a single node in a durable workflow. */
export type FlowNode =
  | FlowStepNode
  | FlowSleepNode
  | FlowSignalNode
  | FlowEmitNode
  | FlowSwitchNode
  | FlowNoteNode;

export interface FlowStepNode {
  kind: "step";
  stepId: string;
  hasCompensation: boolean;
}

export interface FlowSleepNode {
  kind: "sleep";
  durationMs: number;
  stepId?: string;
}

export interface FlowSignalNode {
  kind: "waitForSignal";
  signalId: string;
  timeoutMs?: number;
  stepId?: string;
}

export interface FlowEmitNode {
  kind: "emit";
  eventId: string;
  stepId?: string;
}

export interface FlowSwitchNode {
  kind: "switch";
  stepId: string;
  branchIds: string[];
  hasDefault: boolean;
}

export interface FlowNoteNode {
  kind: "note";
  message: string;
}

/**
 * Serializable description of a durable workflow's structure.
 *
 * Produced by `describeFlow()` without actually executing the workflow.
 * Useful for documentation, visualization dashboards, and tooling.
 */
export interface DurableFlowShape {
  nodes: FlowNode[];
}

// ─── Recording context ───────────────────────────────────────────────────

/**
 * A lightweight mock of `IDurableContext` that records the structure of a
 * workflow instead of executing it. Used internally by `describeFlow()`.
 */
class FlowRecorder implements IDurableContext {
  readonly nodes: FlowNode[] = [];

  readonly executionId = "__flow_describe__";
  readonly attempt = 0;

  private resolveStepId(stepId: string | DurableStepId<unknown>): string {
    return typeof stepId === "string" ? stepId : stepId.id;
  }

  step<T>(stepId: string | DurableStepId<T>): IStepBuilder<T>;
  step<T>(stepId: string | DurableStepId<T>, fn: () => Promise<T>): Promise<T>;
  step<T>(
    stepId: string | DurableStepId<T>,
    options: StepOptions,
    fn: () => Promise<T>,
  ): Promise<T>;
  step<T>(
    stepId: string | DurableStepId<T>,
    optionsOrFn?: StepOptions | (() => Promise<T>),
    _fn?: () => Promise<T>,
  ): IStepBuilder<T> | Promise<T> {
    const id = this.resolveStepId(stepId);

    // When called as builder (.up/.down), return a recording builder
    if (optionsOrFn === undefined) {
      return new FlowStepRecorder<T>(this, id);
    }

    this.nodes.push({ kind: "step", stepId: id, hasCompensation: false });
    return Promise.resolve(undefined as T);
  }

  async sleep(durationMs: number, options?: SleepOptions): Promise<void> {
    this.nodes.push({
      kind: "sleep",
      durationMs,
      stepId: options?.stepId,
    });
  }

  waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
  ): Promise<TPayload>;
  waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
    options: SignalOptions & { timeoutMs: number },
  ): Promise<{ kind: "signal"; payload: TPayload } | { kind: "timeout" }>;
  waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
    options: SignalOptions,
  ): Promise<TPayload>;
  async waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
    options?: SignalOptions,
  ): Promise<unknown> {
    this.nodes.push({
      kind: "waitForSignal",
      signalId: signal.id,
      timeoutMs: options?.timeoutMs,
      stepId: options?.stepId,
    });
    return undefined as TPayload;
  }

  async emit<TPayload>(
    _event: IEventDefinition<TPayload>,
    _payload: TPayload,
    options?: EmitOptions,
  ): Promise<void> {
    this.nodes.push({
      kind: "emit",
      eventId: _event.id,
      stepId: options?.stepId,
    });
  }

  async switch<TValue, TResult>(
    stepId: string,
    _value: TValue,
    branches: SwitchBranch<TValue, TResult>[],
    defaultBranch?: Omit<SwitchBranch<TValue, TResult>, "match">,
  ): Promise<TResult> {
    this.nodes.push({
      kind: "switch",
      stepId,
      branchIds: branches.map((b) => b.id),
      hasDefault: defaultBranch !== undefined,
    });
    return undefined as TResult;
  }

  async note(message: string, _meta?: Record<string, unknown>): Promise<void> {
    this.nodes.push({ kind: "note", message });
  }

  async rollback(): Promise<void> {
    // rollback is a runtime-only concern — nothing to record
  }
}

/**
 * Recording step builder that captures `.up()` / `.down()` calls without executing.
 */
class FlowStepRecorder<T> implements IStepBuilder<T> {
  private hasUp = false;
  private hasDown = false;

  constructor(
    private readonly recorder: FlowRecorder,
    private readonly stepId: string,
  ) {}

  up(_fn: () => Promise<T>): this {
    this.hasUp = true;
    return this;
  }

  down(_fn: (result: T) => Promise<void>): this {
    this.hasDown = true;
    return this;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2> {
    this.recorder.nodes.push({
      kind: "step",
      stepId: this.stepId,
      hasCompensation: this.hasDown,
    });

    const result = Promise.resolve(undefined as T);
    return result.then(
      onfulfilled ?? ((v) => v as unknown as TResult1),
      onrejected,
    );
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * A task with any dependency map — used in the `describeFlow()` overload
 * so that tasks with arbitrary dependencies are accepted.
 */
type AnyTask = ITask<any, any, any, any, any, any>;

/**
 * Statically describe the shape of a durable workflow without executing it.
 *
 * Accepts either:
 * - A **descriptor function** that receives a recording `IDurableContext`.
 * - A **task definition** (built with `r.task(…).build()`) that uses `durable.use()`.
 *
 * When a task is passed, its `run` function is called with a mock dependencies
 * object where every `.use()` returns the recorder. Step bodies are never
 * executed — only the `ctx.*` calls are captured.
 *
 * @example
 * ```ts
 * // From a function:
 * const shape = await describeFlow(async (ctx) => {
 *   await ctx.step("validate", async () => ({ ok: true }));
 *   await ctx.sleep(60_000, { stepId: "cooldown" });
 * });
 *
 * // From an existing task:
 * const shape = await describeFlow(myDurableTask);
 * ```
 */
export async function describeFlow(
  source: ((ctx: IDurableContext) => Promise<void>) | AnyTask,
): Promise<DurableFlowShape> {
  const recorder = new FlowRecorder();

  if (isTask(source)) {
    const mockDeps = createMockDependencies(source, recorder);
    await source.run(undefined, mockDeps);
  } else {
    await source(recorder);
  }

  return { nodes: recorder.nodes };
}

// ─── Internal helpers ────────────────────────────────────────────────────

/** Runtime check for a branded Runner task. */
function isTask(value: unknown): value is AnyTask {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[symbolTask] === true
  );
}

/**
 * Build a mock dependencies object for a task. Every property returns a
 * lightweight proxy whose `.use()` hands back the given `FlowRecorder`.
 *
 * This lets `describeFlow(task)` work regardless of how the dev named their
 * durable dependency key — the recorder is injected into whichever dep
 * calls `.use()`.
 */
function createMockDependencies(
  task: AnyTask,
  recorder: FlowRecorder,
): Record<string, unknown> {
  const rawDeps =
    typeof task.dependencies === "function"
      ? task.dependencies()
      : task.dependencies;

  const durableMock = { use: () => recorder };

  const mockDeps: Record<string, unknown> = {};
  for (const key of Object.keys(rawDeps ?? {})) {
    mockDeps[key] = durableMock;
  }

  return mockDeps;
}
