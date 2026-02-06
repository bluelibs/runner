import type { IEventDefinition } from "../../../types/event";
import type {
  SwitchBranch,
  SleepOptions,
  SignalOptions,
  EmitOptions,
  StepOptions,
  IStepBuilder,
} from "./interfaces/context";

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
class FlowRecorder {
  readonly nodes: FlowNode[] = [];

  readonly executionId = "__flow_describe__";
  readonly attempt = 0;

  step<T>(stepId: string): IStepBuilder<T>;
  step<T>(stepId: string, fn: () => Promise<T>): Promise<T>;
  step<T>(
    stepId: string,
    options: StepOptions,
    fn: () => Promise<T>,
  ): Promise<T>;
  step<T>(
    stepId: string,
    optionsOrFn?: StepOptions | (() => Promise<T>),
    _fn?: () => Promise<T>,
  ): IStepBuilder<T> | Promise<T> {
    // When called as builder (.up/.down), return a recording builder
    if (optionsOrFn === undefined) {
      return new FlowStepRecorder<T>(this, stepId);
    }

    this.nodes.push({ kind: "step", stepId, hasCompensation: false });
    return Promise.resolve(undefined as T);
  }

  async sleep(durationMs: number, options?: SleepOptions): Promise<void> {
    this.nodes.push({
      kind: "sleep",
      durationMs,
      stepId: options?.stepId,
    });
  }

  async waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
    options?: SignalOptions,
  ): Promise<TPayload> {
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

  async note(message: string): Promise<void> {
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
 * Statically describe the shape of a durable workflow without executing it.
 *
 * Pass a function that receives a mock context and calls `ctx.step()`,
 * `ctx.sleep()`, `ctx.waitForSignal()`, `ctx.emit()`, `ctx.switch()`, and
 * `ctx.note()`. The recorder captures each call as a `FlowNode`.
 *
 * The descriptor **must not** rely on step return values for control flow —
 * all return values are `undefined`. Conditional branches should be modeled
 * with `ctx.switch()` instead.
 *
 * @example
 * ```ts
 * const shape = await describeFlow(async (ctx) => {
 *   await ctx.step("validate", async () => ({ ok: true }));
 *   await ctx.switch("route", status, [
 *     { id: "approve", match: (s) => s === "ok", run: async () => "approved" },
 *     { id: "reject",  match: (s) => s === "bad", run: async () => "rejected" },
 *   ]);
 *   await ctx.sleep(60_000, { stepId: "cooldown" });
 * });
 * // shape.nodes → [{ kind: "step", ... }, { kind: "switch", ... }, { kind: "sleep", ... }]
 * ```
 */
export async function describeFlow(
  descriptor: (ctx: FlowRecorder) => Promise<void>,
): Promise<DurableFlowShape> {
  const recorder = new FlowRecorder();
  await descriptor(recorder);
  return { nodes: recorder.nodes };
}
