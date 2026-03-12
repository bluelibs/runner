import type { RuntimeCallSource } from "./runtimeSource";

export type ExecutionFrameKind = "task" | "event" | "hook";

export interface ExecutionFrame {
  readonly kind: ExecutionFrameKind;
  readonly id: string;
  readonly source: RuntimeCallSource;
  readonly timestamp: number;
}

export interface ExecutionContextSnapshot {
  readonly correlationId: string;
  readonly startedAt: number;
  readonly frames: readonly ExecutionFrame[];
  readonly depth: number;
  readonly currentFrame: ExecutionFrame;
}

export interface ExecutionContextProvideOptions {
  readonly correlationId?: string;
}

export interface ExecutionRecordNode {
  readonly id: string;
  readonly frame: ExecutionFrame;
  readonly startedAt: number;
  readonly endedAt: number | undefined;
  readonly status: "running" | "completed" | "failed";
  readonly error: unknown;
  readonly children: readonly ExecutionRecordNode[];
}

export interface ExecutionRecordSnapshot {
  readonly correlationId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly roots: readonly ExecutionRecordNode[];
}

export interface ExecutionRecordResult<TResult> {
  readonly result: TResult;
  readonly recording: ExecutionRecordSnapshot | undefined;
}

export interface CycleDetectionConfig {
  readonly maxDepth: number;
  readonly maxRepetitions: number;
}

export interface CycleDetectionOptions {
  maxDepth?: number;
  maxRepetitions?: number;
}

export interface ExecutionContextOptions {
  createCorrelationId?: () => string;
  cycleDetection?: boolean | CycleDetectionOptions;
}

export interface ExecutionContextConfig {
  readonly createCorrelationId: () => string;
  readonly cycleDetection: CycleDetectionConfig | null;
}

export interface ExecutionContextAccessor {
  readonly id: "asyncContexts.execution";
  use(): ExecutionContextSnapshot;
  tryUse(): ExecutionContextSnapshot | undefined;
  has(): boolean;
  provide<T>(fn: () => T): T;
  provide<T>(options: ExecutionContextProvideOptions, fn: () => T): T;
  record<T>(fn: () => T): Promise<ExecutionRecordResult<Awaited<T>>>;
  record<T>(
    options: ExecutionContextProvideOptions,
    fn: () => T,
  ): Promise<ExecutionRecordResult<Awaited<T>>>;
}

export const EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS: CycleDetectionConfig =
  {
    maxDepth: 1000,
    maxRepetitions: 3,
  };
