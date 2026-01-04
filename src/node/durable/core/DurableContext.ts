import type { IEventBus } from "./interfaces/bus";
import type {
  EmitOptions,
  IDurableContext,
  IStepBuilder,
  SignalOptions,
  SleepOptions,
  StepOptions,
} from "./interfaces/context";
import { SuspensionSignal } from "./interfaces/context";
import type { IDurableStore } from "./interfaces/store";
import { StepBuilder } from "./StepBuilder";
import type { IEventDefinition } from "../../../types/event";
import type { DurableSignalId, DurableStepId } from "./ids";
import {
  createDurableAuditEntryId,
  isDurableInternalStepId,
  type DurableAuditEmitter,
  type DurableAuditEntry,
  type DurableAuditEntryInput,
} from "./audit";
import { isRecord, sleepMs, withTimeout } from "./utils";

type WaitForSignalOutcome<TPayload> =
  | { kind: "signal"; payload: TPayload }
  | { kind: "timeout" };

type SignalStepState =
  | { state: "waiting"; signalId?: string }
  | { state: "waiting"; signalId?: string; timeoutAtMs: number; timerId: string }
  | { state: "completed"; payload: unknown }
  | { state: "timed_out" };

type SignalInput<TPayload> =
  | string
  | IEventDefinition<TPayload>
  | DurableSignalId<TPayload>;

function getSignalId(signal: SignalInput<unknown>): string {
  return typeof signal === "string" ? signal : signal.id;
}

function parseSignalStepState(value: unknown): SignalStepState | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (state === "waiting") {
    const signalId = value.signalId;
    const timeoutAtMs = value.timeoutAtMs;
    const timerId = value.timerId;
    if (signalId !== undefined && typeof signalId !== "string") return null;
    if (typeof timeoutAtMs === "number" && typeof timerId === "string") {
      return { state: "waiting", signalId, timeoutAtMs, timerId };
    }
    return { state: "waiting", signalId };
  }
  if (state === "completed") {
    return { state: "completed", payload: value.payload };
  }
  if (state === "timed_out") {
    return { state: "timed_out" };
  }
  return null;
}

export class DurableContext implements IDurableContext {
  private sleepIndex = 0;
  private readonly signalIndexes = new Map<string, number>();
  private readonly emitIndexes = new Map<string, number>();
  private noteIndex = 0;
  private readonly auditEnabled: boolean;
  private readonly auditEmitter: DurableAuditEmitter | null;
  private readonly implicitInternalStepIdsPolicy: "allow" | "warn" | "error";
  private readonly implicitInternalStepIdsWarned = new Set<
    "sleep" | "emit" | "waitForSignal"
  >();
  private readonly compensations: Array<{
    stepId: string;
    action: () => Promise<void>;
  }> = [];

  constructor(
    private readonly store: IDurableStore,
    private readonly bus: IEventBus,
    public readonly executionId: string,
    public readonly attempt: number,
    options: {
      auditEnabled?: boolean;
      auditEmitter?: DurableAuditEmitter;
      implicitInternalStepIds?: "allow" | "warn" | "error";
    } = {},
  ) {
    this.auditEnabled = options.auditEnabled ?? false;
    this.auditEmitter = options.auditEmitter ?? null;
    this.implicitInternalStepIdsPolicy = options.implicitInternalStepIds ?? "allow";
  }

  private assertOrWarnImplicitInternalStepId(
    kind: "sleep" | "emit" | "waitForSignal",
  ): void {
    const policy = this.implicitInternalStepIdsPolicy;
    if (policy === "allow") return;

    const message =
      `DurableContext.${kind}() is using an implicit step id (call-order based). ` +
      `This can break replay for in-flight executions after refactors. ` +
      `Provide a stable id via { stepId: "..." } (or set determinism.implicitInternalStepIds to "allow").`;

    if (policy === "error") {
      throw new Error(message);
    }

    if (this.implicitInternalStepIdsWarned.has(kind)) return;
    this.implicitInternalStepIdsWarned.add(kind);
    // eslint-disable-next-line no-console
    console.warn(message);
  }

  private async appendAuditEntry(
    entry: DurableAuditEntryInput,
  ): Promise<void> {
    const shouldPersist = this.auditEnabled === true && !!this.store.appendAuditEntry;
    const shouldEmit = this.auditEmitter !== null;
    if (!shouldPersist && !shouldEmit) return;
    const at = new Date();
    const fullEntry = {
      ...entry,
      id: createDurableAuditEntryId(at.getTime()),
      executionId: this.executionId,
      attempt: this.attempt,
      at,
    } as DurableAuditEntry;
    if (shouldPersist) {
      try {
        await this.store.appendAuditEntry!(fullEntry);
      } catch {
        // Audit persistence must not affect workflow correctness.
      }
    }

    if (this.auditEmitter) {
      try {
        await this.auditEmitter.emit(fullEntry);
      } catch {
        // Audit emissions must not affect workflow correctness.
      }
    }
  }

  private nextIndex(counter: Map<string, number>, key: string): number {
    const current = counter.get(key) ?? 0;
    counter.set(key, current + 1);
    return current;
  }

  private async withSignalLock<TPayload>(
    signalId: string,
    fn: () => Promise<TPayload>,
  ): Promise<TPayload> {
    if (!this.store.acquireLock || !this.store.releaseLock) {
      return fn();
    }

    const lockResource = `signal:${this.executionId}:${signalId}`;
    const lockTtlMs = 10_000;
    const maxAttempts = 20;

    let lockId: string | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      lockId = await this.store.acquireLock(lockResource, lockTtlMs);
      if (lockId !== null) break;
      await sleepMs(5);
    }

    if (lockId === null) {
      throw new Error(
        `Failed to acquire signal lock for '${signalId}' on execution '${this.executionId}'`,
      );
    }

    try {
      return await fn();
    } finally {
      try {
        await this.store.releaseLock(lockResource, lockId);
      } catch {
        // best-effort cleanup; ignore
      }
    }
  }

  private getStepId(stepId: string | DurableStepId<unknown>): string {
    return typeof stepId === "string" ? stepId : stepId.id;
  }

  private assertUserStepId(stepId: string): void {
    if (stepId.startsWith("__")) {
      throw new Error(
        `Step IDs starting with '__' are reserved for durable internals: '${stepId}'`,
      );
    }

    if (stepId.startsWith("rollback:")) {
      throw new Error(
        `Step IDs starting with 'rollback:' are reserved for durable internals: '${stepId}'`,
      );
    }
  }

  private internalStep<T>(
    stepId: string,
    options: StepOptions = {},
  ): StepBuilder<T> {
    return new StepBuilder<T>(this, stepId, options);
  }

  step<T>(stepId: string): IStepBuilder<T>;
  step<T>(stepId: DurableStepId<T>): IStepBuilder<T>;
  step<T>(stepId: string | DurableStepId<T>, fn: () => Promise<T>): Promise<T>;
  step<T>(
    stepId: string | DurableStepId<T>,
    options: StepOptions,
    fn: () => Promise<T>,
  ): Promise<T>;
  step<T>(
    stepId: string | DurableStepId<T>,
    optionsOrFn?: StepOptions | (() => Promise<T>),
    fn?: () => Promise<T>,
  ): any {
    const resolvedStepId = this.getStepId(stepId);
    this.assertUserStepId(resolvedStepId);
    if (optionsOrFn === undefined) {
      return new StepBuilder<T>(this, resolvedStepId);
    }

    const fnToExecute = typeof optionsOrFn === "function" ? optionsOrFn : fn!;
    const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;

    return this._executeStep(resolvedStepId, options, fnToExecute);
  }

  async _executeStep<T>(
    stepId: string,
    options: StepOptions,
    upFn: () => Promise<T>,
    downFn?: (result: T) => Promise<void>,
  ): Promise<T> {
    const cached = await this.store.getStepResult(this.executionId, stepId);
    if (cached) {
      const result = cached.result as T;
      if (downFn) {
        this.registerCompensation(stepId, result, downFn);
      }
      return result;
    }

    let attempts = 0;
    const maxRetries = options.retries ?? 0;
    const startedAt = Date.now();

    const executeWithRetry = async (): Promise<T> => {
      try {
        if (options.timeout) {
          return await withTimeout(
            upFn(),
            options.timeout,
            `Step ${stepId} timed out`,
          );
        }
        return await upFn();
      } catch (error) {
        if (attempts < maxRetries) {
          attempts += 1;
          const delay = Math.pow(2, attempts) * 100;
          await sleepMs(delay);
          return executeWithRetry();
        }
        throw error;
      }
    };

    const result = await executeWithRetry();
    const durationMs = Date.now() - startedAt;

    await this.store.saveStepResult({
      executionId: this.executionId,
      stepId,
      result,
      completedAt: new Date(),
    });

    await this.appendAuditEntry({
      kind: "step_completed",
      stepId,
      durationMs,
      isInternal: isDurableInternalStepId(stepId),
    });

    if (downFn) {
      this.registerCompensation(stepId, result, downFn);
    }

    return result;
  }

  private registerCompensation<T>(
    stepId: string,
    result: T,
    downFn: (result: T) => Promise<void>,
  ): void {
    this.compensations.push({
      stepId,
      action: async () => downFn(result),
    });
  }

  async rollback(): Promise<void> {
    const reversed = [...this.compensations].reverse();
    try {
      for (const comp of reversed) {
        const rollbackStepId = `rollback:${comp.stepId}`;
        await this.internalStep<{ rolledBack: true }>(rollbackStepId).up(
          async () => {
            await comp.action();
            return { rolledBack: true };
          },
        );
      }
    } catch (error) {
      if (error instanceof SuspensionSignal) throw error;

      const errorInfo = {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };

      await this.store.updateExecution(this.executionId, {
        status: "compensation_failed",
        error: errorInfo,
        updatedAt: new Date(),
      });

      throw new Error("Compensation failed: " + errorInfo.message);
    }
  }

  async sleep(durationMs: number, options?: SleepOptions): Promise<void> {
    let sleepStepId: string;
    
    if (options?.stepId) {
      // Use explicit step ID for replay stability
      sleepStepId = `__sleep:${options.stepId}`;
    } else {
      this.assertOrWarnImplicitInternalStepId("sleep");
      // Fall back to auto-indexed ID
      const sleepStepIndex = this.sleepIndex;
      this.sleepIndex += 1;
      sleepStepId = `__sleep:${sleepStepIndex}`;
    }

    const existing = await this.store.getStepResult(
      this.executionId,
      sleepStepId,
    );

    const existingState = existing?.result as
      | { state: "sleeping"; timerId: string; fireAtMs: number }
      | { state: "completed" }
      | undefined;

    if (existingState?.state === "completed") {
      return;
    }

    if (existingState?.state === "sleeping") {
      await this.store.createTimer({
        id: existingState.timerId,
        executionId: this.executionId,
        stepId: sleepStepId,
        type: "sleep",
        fireAt: new Date(existingState.fireAtMs),
        status: "pending",
      });
      throw new SuspensionSignal("sleep");
    }

    const timerId = `sleep:${this.executionId}:${sleepStepId}`;
    const fireAtMs = Date.now() + durationMs;

    await this.store.createTimer({
      id: timerId,
      executionId: this.executionId,
      stepId: sleepStepId,
      type: "sleep",
      fireAt: new Date(fireAtMs),
      status: "pending",
    });

    await this.store.saveStepResult({
      executionId: this.executionId,
      stepId: sleepStepId,
      result: { state: "sleeping", timerId, fireAtMs },
      completedAt: new Date(),
    });

    await this.appendAuditEntry({
      kind: "sleep_scheduled",
      stepId: sleepStepId,
      timerId,
      durationMs,
      fireAt: new Date(fireAtMs),
    });

    throw new SuspensionSignal("sleep");
  }

  async waitForSignal<TPayload>(
    signal: SignalInput<TPayload>,
  ): Promise<TPayload>;
  async waitForSignal<TPayload>(
    signal: SignalInput<TPayload>,
    options: SignalOptions & { timeoutMs: number },
  ): Promise<WaitForSignalOutcome<TPayload>>;
  async waitForSignal<TPayload>(
    signal: SignalInput<TPayload>,
    options: SignalOptions,
  ): Promise<TPayload>;
  async waitForSignal<TPayload>(
    signal: SignalInput<TPayload>,
    options?: SignalOptions,
  ): Promise<TPayload | WaitForSignalOutcome<TPayload>> {
    const signalId = getSignalId(signal);
    const hasTimeout = options?.timeoutMs !== undefined;
    const resolveCompleted = (
      payload: TPayload,
    ): TPayload | WaitForSignalOutcome<TPayload> =>
      hasTimeout ? { kind: "signal", payload } : payload;
    const resolveTimedOut = (): WaitForSignalOutcome<TPayload> => {
      if (!hasTimeout) {
        throw new Error(`Signal '${signalId}' timed out`);
      }
      return { kind: "timeout" };
    };

    return await this.withSignalLock(signalId, async () => {
      let stepId: string;
      if (options?.stepId) {
        if (!this.store.listStepResults) {
          throw new Error(
            "waitForSignal({ stepId }) requires a store that implements listStepResults()",
          );
        }
        // Use explicit step ID for replay stability
        stepId = `__signal:${options.stepId}`;
      } else {
        this.assertOrWarnImplicitInternalStepId("waitForSignal");
        // Fall back to auto-indexed ID
        const signalStepIndex = this.nextIndex(this.signalIndexes, signalId);
        stepId =
          signalStepIndex === 0
            ? `__signal:${signalId}`
            : `__signal:${signalId}:${signalStepIndex}`;
      }

      const existing = await this.store.getStepResult(this.executionId, stepId);
      if (existing) {
        const state = parseSignalStepState(existing.result);
        if (!state) {
          throw new Error(
            `Invalid signal step state for '${signalId}' at '${stepId}'`,
          );
        }
        if (state.state === "completed") {
          const payload = state.payload as TPayload;
          return resolveCompleted(payload);
        }
        if (state.state === "timed_out") {
          return resolveTimedOut();
        }
        if (state.state === "waiting") {
          if (state.signalId !== undefined && state.signalId !== signalId) {
            throw new Error(
              `Invalid signal step state for '${signalId}' at '${stepId}'`,
            );
          }
          if (options?.timeoutMs !== undefined) {
            if ("timeoutAtMs" in state && "timerId" in state) {
              await this.store.createTimer({
                id: state.timerId,
                executionId: this.executionId,
                stepId,
                type: "signal_timeout",
                fireAt: new Date(state.timeoutAtMs),
                status: "pending",
              });
            } else {
              const timerId = `signal_timeout:${this.executionId}:${stepId}`;
              const timeoutAtMs = Date.now() + options.timeoutMs;

              await this.store.createTimer({
                id: timerId,
                executionId: this.executionId,
                stepId,
                type: "signal_timeout",
                fireAt: new Date(timeoutAtMs),
                status: "pending",
              });

              await this.store.saveStepResult({
                executionId: this.executionId,
                stepId,
                result: { state: "waiting", signalId, timeoutAtMs, timerId },
                completedAt: new Date(),
              });

              await this.appendAuditEntry({
                kind: "signal_waiting",
                stepId,
                signalId,
                timeoutMs: options.timeoutMs,
                timeoutAtMs,
                timerId,
                reason: "timeout_armed",
              });
            }
          }
          throw new SuspensionSignal("yield");
        }
      }

      if (options?.timeoutMs !== undefined) {
        const timerId = `signal_timeout:${this.executionId}:${stepId}`;
        const timeoutAtMs = Date.now() + options.timeoutMs;

        await this.store.createTimer({
          id: timerId,
          executionId: this.executionId,
          stepId,
          type: "signal_timeout",
          fireAt: new Date(timeoutAtMs),
          status: "pending",
        });

        await this.store.saveStepResult({
          executionId: this.executionId,
          stepId,
          result: { state: "waiting", signalId, timeoutAtMs, timerId },
          completedAt: new Date(),
        });

        await this.appendAuditEntry({
          kind: "signal_waiting",
          stepId,
          signalId,
          timeoutMs: options.timeoutMs,
          timeoutAtMs,
          timerId,
          reason: "initial",
        });

        throw new SuspensionSignal("yield");
      }

      await this.store.saveStepResult({
        executionId: this.executionId,
        stepId,
        result: { state: "waiting", signalId },
        completedAt: new Date(),
      });

      await this.appendAuditEntry({
        kind: "signal_waiting",
        stepId,
        signalId,
        reason: "initial",
      });

      throw new SuspensionSignal("yield");
    });
  }

  async emit<TPayload>(
    event:
      | string
      | { id: string }
      | IEventDefinition<TPayload>
      | DurableSignalId<TPayload>,
    payload: TPayload,
    options?: EmitOptions,
  ): Promise<void> {
    const eventId = typeof event === "string" ? event : event.id;
    
    let stepId: string;
    if (options?.stepId) {
      // Use explicit step ID for replay stability
      stepId = `__emit:${options.stepId}`;
    } else {
      this.assertOrWarnImplicitInternalStepId("emit");
      // Fall back to auto-indexed ID
      const emitIndex = this.nextIndex(this.emitIndexes, eventId);
      stepId = `__emit:${eventId}:${emitIndex}`;
    }

    await this.internalStep<void>(stepId).up(async () => {
      await this.bus.publish("durable:events", {
        type: eventId,
        payload,
        timestamp: new Date(),
      });

      await this.appendAuditEntry({
        kind: "emit_published",
        stepId,
        eventId,
      });
    });
  }

  async note(message: string, meta?: Record<string, unknown>): Promise<void> {
    const shouldPersist =
      this.auditEnabled === true && !!this.store.appendAuditEntry;
    const shouldEmit = this.auditEmitter !== null;
    if (!shouldPersist && !shouldEmit) return;
    const stepId = `__note:${this.noteIndex}`;
    this.noteIndex += 1;

    await this.internalStep<void>(stepId).up(async () => {
      await this.appendAuditEntry({ kind: "note", message, meta });
    });
  }
}
