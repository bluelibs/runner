import type { RuntimeCallSource } from "./runtimeSource";

/**
 * Execution frame kinds tracked by the built-in execution context.
 */
export type ExecutionFrameKind = "task" | "event" | "hook";

/**
 * One step in the current causal execution chain.
 */
export interface ExecutionFrame {
  /** Runner definition kind currently executing. */
  readonly kind: ExecutionFrameKind;
  /** Canonical definition id of the current frame. */
  readonly id: string;
  /**
   * Admission source that led to this frame being entered.
   *
   * `source.id` is the user-facing display id. `source.path`, when present,
   * preserves the exact canonical runtime path that admitted this frame.
   */
  readonly source: RuntimeCallSource;
  /** Epoch timestamp captured when the frame started. */
  readonly timestamp: number;
}

/**
 * Snapshot of the currently active execution context.
 */
export interface ExecutionContextSnapshot {
  /** Correlation id shared across the current execution tree. */
  readonly correlationId: string;
  /** Epoch timestamp for the top-level execution start. */
  readonly startedAt: number;
  /** Ordered stack of execution frames from root to current frame. */
  readonly frames: readonly ExecutionFrame[];
  /** Current nesting depth within the execution tree. */
  readonly depth: number;
  /** The frame that is currently active. */
  readonly currentFrame: ExecutionFrame;
}

/**
 * Optional overrides when manually creating or recording an execution context.
 */
export interface ExecutionContextProvideOptions {
  /** Overrides the generated correlation id for this execution root. */
  readonly correlationId?: string;
}

/**
 * One node in a recorded execution tree.
 */
export interface ExecutionRecordNode {
  /** Stable node id inside the recorded execution tree. */
  readonly id: string;
  /** Frame metadata for this recorded node. */
  readonly frame: ExecutionFrame;
  /** Epoch timestamp when this node started. */
  readonly startedAt: number;
  /** Epoch timestamp when this node finished, or `undefined` while still running. */
  readonly endedAt: number | undefined;
  /** Final execution status for this node. */
  readonly status: "running" | "completed" | "failed";
  /** Error captured for failed nodes. */
  readonly error: unknown;
  /** Nested executions triggered from this node. */
  readonly children: readonly ExecutionRecordNode[];
}

/**
 * Completed execution recording tree returned by `record(...)`.
 */
export interface ExecutionRecordSnapshot {
  /** Correlation id shared by every node in the recording. */
  readonly correlationId: string;
  /** Epoch timestamp when recording began. */
  readonly startedAt: number;
  /** Epoch timestamp when recording completed. */
  readonly finishedAt: number;
  /** Top-level recorded executions for this snapshot. */
  readonly roots: readonly ExecutionRecordNode[];
}

/**
 * Result wrapper returned by `record(...)`.
 */
export interface ExecutionRecordResult<TResult> {
  /** Result returned by the recorded callback. */
  readonly result: TResult;
  /** Recording tree when execution-context recording is enabled. */
  readonly recording: ExecutionRecordSnapshot | undefined;
}

/**
 * Concrete cycle-detection thresholds used by the execution-context subsystem.
 */
export interface CycleDetectionConfig {
  /** Maximum execution depth before Runner treats the flow as cyclic. */
  readonly maxDepth: number;
  /** Maximum allowed repetitions for the same frame pattern. */
  readonly maxRepetitions: number;
}

/**
 * User-facing cycle-detection overrides for `run(..., { executionContext })`.
 */
export interface CycleDetectionOptions {
  /** Overrides the default maximum execution depth. */
  maxDepth?: number;
  /** Overrides the default frame repetition threshold. */
  maxRepetitions?: number;
}

/**
 * User-facing execution-context options accepted by `run(...)`.
 */
export interface ExecutionContextOptions {
  /** Custom correlation id factory for new top-level executions. */
  createCorrelationId?: () => string;
  /** Enables cycle detection or customizes its thresholds. */
  cycleDetection?: boolean | CycleDetectionOptions;
}

/**
 * Normalized execution-context configuration stored on the runtime.
 */
export interface ExecutionContextConfig {
  /** Normalized correlation id factory used by the runtime. */
  readonly createCorrelationId: () => string;
  /** Normalized cycle-detection config, or `null` when disabled. */
  readonly cycleDetection: CycleDetectionConfig | null;
}

/**
 * Built-in async-context accessor for execution tracing.
 */
export interface ExecutionContextAccessor {
  /** Stable id of the built-in execution async context. */
  readonly id: "executionContext";
  /** Returns the current execution snapshot or throws when unavailable. */
  use(): ExecutionContextSnapshot;
  /** Returns the current execution snapshot when available. */
  tryUse(): ExecutionContextSnapshot | undefined;
  /** Reports whether an execution snapshot is currently active. */
  has(): boolean;
  /** Runs a callback inside an execution context using default options. */
  provide<T>(fn: () => T): T;
  /** Runs a callback inside an execution context with explicit options. */
  provide<T>(options: ExecutionContextProvideOptions, fn: () => T): T;
  /** Records an execution tree using default options. */
  record<T>(fn: () => T): Promise<ExecutionRecordResult<Awaited<T>>>;
  /** Records an execution tree with explicit options. */
  record<T>(
    options: ExecutionContextProvideOptions,
    fn: () => T,
  ): Promise<ExecutionRecordResult<Awaited<T>>>;
}

/**
 * Default thresholds used when execution-context cycle detection is enabled.
 */
export const EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS: CycleDetectionConfig =
  {
    /** Default maximum execution depth before cycle detection fails fast. */
    maxDepth: 1000,
    /** Default number of repeated frames allowed before cycle detection fails fast. */
    maxRepetitions: 3,
  };
