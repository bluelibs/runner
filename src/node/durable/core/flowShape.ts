import type { IEventDefinition } from "../../../types/event";
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
 * Produced by `recordFlowShape()` without actually executing the workflow.
 * Useful for documentation, visualization dashboards, and tooling.
 */
export interface DurableFlowShape {
  nodes: FlowNode[];
}

// ─── Recording context ───────────────────────────────────────────────────

/**
 * A lightweight mock of `IDurableContext` that records the structure of a
 * workflow instead of executing it. Used internally by `recordFlowShape()`.
 */
class FlowRecorder implements IDurableContext {
  readonly nodes: FlowNode[] = [];

  readonly executionId = "__flow_record__";
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
  private hasDown = false;

  constructor(
    private readonly recorder: FlowRecorder,
    private readonly stepId: string,
  ) {}

  up(_fn: () => Promise<T>): this {
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
    return result.then(onfulfilled, onrejected) as Promise<TResult1 | TResult2>;
  }
}

/**
 * Record a durable workflow flow-shape without executing it.
 *
 * This runs the descriptor against a recording `IDurableContext` that captures
 * `ctx.*` calls into a serializable shape.
 */
export async function recordFlowShape(
  descriptor: (ctx: IDurableContext) => Promise<void>,
): Promise<DurableFlowShape> {
  const recorder = new FlowRecorder();
  await descriptor(recorder);
  return { nodes: recorder.nodes };
}
