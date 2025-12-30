import type { IEventBus } from "./interfaces/bus";
import type {
  IDurableContext,
  IStepBuilder,
  StepOptions,
} from "./interfaces/context";
import { SuspensionSignal } from "./interfaces/context";
import type { IDurableStore } from "./interfaces/store";
import { StepBuilder } from "./StepBuilder";
import type { IEventDefinition } from "../../../types/event";
import { isRecord, sleepMs, withTimeout } from "./utils";

type WaitForSignalOutcome<TPayload> =
  | { kind: "signal"; payload: TPayload }
  | { kind: "timeout" };

type SignalStepState =
  | { state: "waiting" }
  | { state: "waiting"; timeoutAtMs: number; timerId: string }
  | { state: "completed"; payload: unknown }
  | { state: "timed_out" };

function getSignalId(signal: string | IEventDefinition<unknown>): string {
  return typeof signal === "string" ? signal : signal.id;
}

function parseSignalStepState(value: unknown): SignalStepState | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (state === "waiting") {
    const timeoutAtMs = value.timeoutAtMs;
    const timerId = value.timerId;
    if (typeof timeoutAtMs === "number" && typeof timerId === "string") {
      return { state: "waiting", timeoutAtMs, timerId };
    }
    return { state: "waiting" };
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
  private readonly compensations: Array<{
    stepId: string;
    action: () => Promise<void>;
  }> = [];

  constructor(
    private readonly store: IDurableStore,
    private readonly bus: IEventBus,
    public readonly executionId: string,
    public readonly attempt: number,
  ) {}

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
    fn?: () => Promise<T>,
  ): any {
    if (optionsOrFn === undefined) {
      return new StepBuilder<T>(this, stepId);
    }

    const fnToExecute = typeof optionsOrFn === "function" ? optionsOrFn : fn!;
    const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;

    return this._executeStep(stepId, options, fnToExecute);
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

    await this.store.saveStepResult({
      executionId: this.executionId,
      stepId,
      result,
      completedAt: new Date(),
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
        await this.step(rollbackStepId, async () => {
          await comp.action();
          return { rolledBack: true };
        });
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

  async sleep(durationMs: number): Promise<void> {
    const sleepStepIndex = this.sleepIndex;
    this.sleepIndex += 1;

    const sleepStepId = `__sleep:${sleepStepIndex}`;

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

    throw new SuspensionSignal("sleep");
  }

  async waitForSignal<TPayload>(
    signal: string | IEventDefinition<TPayload>,
  ): Promise<TPayload>;
  async waitForSignal<TPayload>(
    signal: string | IEventDefinition<TPayload>,
    options: { timeoutMs: number },
  ): Promise<WaitForSignalOutcome<TPayload>>;
  async waitForSignal<TPayload>(
    signal: string | IEventDefinition<TPayload>,
    options?: { timeoutMs: number },
  ): Promise<TPayload | WaitForSignalOutcome<TPayload>> {
    const signalId = getSignalId(signal);
    const stepId = `__signal:${signalId}`;
    const existing = await this.store.getStepResult(this.executionId, stepId);
    if (existing) {
      const state = parseSignalStepState(existing.result);
      if (state?.state === "completed") {
        const payload = state.payload as TPayload;
        return options ? { kind: "signal", payload } : payload;
      }
      if (state?.state === "timed_out") {
        if (!options) {
          throw new Error(`Signal '${signalId}' timed out`);
        }
        return { kind: "timeout" };
      }
      if (state?.state === "waiting") {
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
              result: { state: "waiting", timeoutAtMs, timerId },
              completedAt: new Date(),
            });
          }
        }
        throw new SuspensionSignal("yield");
      }

      const legacy = existing.result as TPayload;
      return options ? { kind: "signal", payload: legacy } : legacy;
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
        result: { state: "waiting", timeoutAtMs, timerId },
        completedAt: new Date(),
      });

      throw new SuspensionSignal("yield");
    }

    await this.store.saveStepResult({
      executionId: this.executionId,
      stepId,
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    throw new SuspensionSignal("yield");
  }

  async emit<TPayload>(
    event: string | { id: string },
    payload: TPayload,
  ): Promise<void> {
    const eventId = typeof event === "string" ? event : event.id;
    await this.step(`emit:${eventId}:${this.executionId}`).up(async () => {
      await this.bus.publish("durable:events", {
        type: eventId,
        payload,
        timestamp: new Date(),
      });
    });
  }
}
