import type { ExecutionLockState } from "./managers/ExecutionManager.locking";
import type { IEventBus } from "./interfaces/bus";
import type {
  ContinueAsNewOptions,
  DurableInfo,
  DurableStepContext,
  IDurableWorkflowContext,
  IDurableStepBuilder,
  SignalOptions,
  SleepOptions,
  StepOptions,
  SwitchBranch,
  WaitForSignalResult,
  WaitForExecutionOptions,
  WorkflowOptions,
} from "./interfaces/context";
import type { IDurableStore } from "./interfaces/store";
import type { DurableStateOptions } from "./interfaces/context.state";
import { ContinuationSignal } from "./interfaces/context";
import { StepBuilder } from "./StepBuilder";
import {
  createStepCurrent,
  createWorkflowStepCurrent,
  setExecutionCurrent,
} from "./current";
import type { IEventDefinition } from "../../../types/event";
import type { AnyTask, ITask } from "../../../types/task";
import type {
  ExtractTaskInput,
  ResolveTaskOutput,
} from "../../../types/utilities";
import type { DurableStepId } from "./ids";
import { DurableAuditEntryKind, type DurableAuditEmitter } from "./audit";
import type { DurableExecutionCurrentWorkflowMeta } from "./types";
import { ExecutionStatus } from "./types";
import { createDurableContextAudit } from "./durable-context/DurableContext.audit";
import {
  createDurableStateOperations,
  type DurableStateOperations,
} from "./durable-context/state";
import {
  createDurableContextDeterminism,
  type ImplicitInternalStepIdKind,
  type ImplicitInternalStepIdsPolicy,
} from "./durable-context/DurableContext.determinism";
import type { DurableContextDeterminism } from "./durable-context/DurableContext.determinism";
import type { DurableContextAudit } from "./durable-context/DurableContext.audit";
import {
  executeDurableStep,
  rollbackDurableCompensations,
  type DurableCompensation,
} from "./durable-context/DurableContext.steps";
import { sleepDurably } from "./durable-context/DurableContext.sleep";
import { waitForExecutionDurably } from "./durable-context/DurableContext.waitForExecution";
import { waitForSignalDurably } from "./durable-context/DurableContext.waitForSignal";
import { switchDurably } from "./durable-context/DurableContext.switch";
import { assertFiniteDurationMs } from "./utils";
import {
  durableContextCancelledError,
  durableContinueAsNewRejectedError,
  durableExecutionInvariantError,
} from "../../../errors";
import { durableWorkflowTag } from "../tags/durableWorkflow.tag";
import { throwDurablePauseInterruption } from "./pauseInterruption";
import { AsyncLocalStorage } from "node:async_hooks";
import { isTask } from "../../../definers/tools";
import type { ITaskExecutor } from "./interfaces/service";
import {
  OperationJournal,
  type DurableReplayObserver,
} from "./durable-context/operationJournal";
import { createExecutionStepId } from "./durable-context/DurableContext.waitForExecutionState";
import { createSignalWaitIdentity } from "./durable-context/operationIds";
import { check, Match } from "../../../tools/check";

function isStepTask(value: unknown): value is AnyTask {
  return isTask(value);
}

/**
 * Per-execution workflow toolkit used by durable tasks.
 *
 * `DurableContext` is created by `ExecutionManager` for each execution attempt and
 * made available to user code via `DurableResource.use()` (AsyncLocalStorage).
 *
 * It provides deterministic "save points" (`step()`), typed subflow starts
 * (`workflow()`), and durable suspension primitives (`sleep()`, `waitForSignal()`,
 * `waitForExecution()`).
 * The durable store is the source of truth; this class is intentionally thin state
 * around indexes/guards to keep a single in-memory attempt deterministic.
 */
export class DurableContext implements IDurableWorkflowContext {
  private readonly stepContext = new AsyncLocalStorage<DurableStepContext>();
  private readonly taskExecutor?: ITaskExecutor;
  private readonly getTaskKey: (task: AnyTask) => string;
  private readonly journal: OperationJournal;
  private readonly stepIdentity?: string;
  private readonly executionLockState: ExecutionLockState | undefined;
  private readonly sleepIndexRef = { current: 0 };
  private readonly signalIndexes = new Map<string, number>();
  private readonly eventIndexes = new Map<string, number>();
  private noteIndex = 0;

  private readonly implicitInternalStepIdsWarned =
    new Set<ImplicitInternalStepIdKind>();

  // Track user and internal steps seen in this execution context instance
  private readonly seenStepIds = new Set<string>();

  private readonly compensations: DurableCompensation[] = [];

  private readonly audit: DurableContextAudit;
  private readonly state: DurableStateOperations;
  private readonly determinism: DurableContextDeterminism;
  private readonly auditEnabled: boolean;
  private readonly auditEmitter: DurableAuditEmitter | null;
  private readonly implicitInternalStepIdsPolicy: ImplicitInternalStepIdsPolicy;
  private readonly declaredSignalIds: ReadonlySet<string> | null;
  private readonly assertLockOwnership: () => void;
  private readonly startWorkflowExecution: <TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
    input: TInput | undefined,
    options: {
      timeout?: number;
      priority?: number;
      parentExecutionId: string;
      idempotencyKey: string;
    },
  ) => Promise<string>;
  private readonly getTaskPersistenceId: (
    task: ITask<any, Promise<any>, any, any, any, any>,
  ) => string;
  private readonly cancellationSignal: AbortSignal;

  constructor(
    private readonly store: IDurableStore,
    /** Preserves constructor compatibility after removal of context bus emission. */
    _bus: IEventBus,
    public readonly executionId: string,
    public readonly attempt: number,
    options: {
      auditEnabled?: boolean;
      auditEmitter?: DurableAuditEmitter;
      implicitInternalStepIds?: ImplicitInternalStepIdsPolicy;
      declaredSignalIds?: ReadonlySet<string> | null;
      assertLockOwnership?: () => void;
      startWorkflowExecution?: <TInput, TResult>(
        task: ITask<TInput, Promise<TResult>, any, any, any, any>,
        input: TInput | undefined,
        options: {
          timeout?: number;
          priority?: number;
          parentExecutionId: string;
          idempotencyKey: string;
        },
      ) => Promise<string>;
      getTaskPersistenceId?: (
        task: ITask<any, Promise<any>, any, any, any, any>,
      ) => string;
      /** Shares attempt ownership with store-coordinated step leases. */
      executionLockState?: ExecutionLockState;
      cancellationSignal?: AbortSignal;
      /** Runner task execution for the additive task-step overload. */
      taskExecutor?: ITaskExecutor;
      /** Canonical task identity, independent of workflow persistence keys. */
      getTaskKey?: (task: AnyTask) => string;
      /** @internal Captures new runs; legacy contexts and executions omit this option. */
      historyRecorded?: boolean;
      /** @internal Read-only compatibility replay observer. */
      replay?: DurableReplayObserver;
      /** @internal Commands have distinct effect identities while sharing target state. */
      stepIdentity?: string;
    } = {},
  ) {
    this.executionLockState = options.executionLockState;
    this.taskExecutor = options.taskExecutor;
    this.getTaskKey = options.getTaskKey ?? ((task) => task.id);
    this.journal = new OperationJournal(
      store,
      executionId,
      options.historyRecorded === true,
      options.replay,
    );
    this.stepIdentity = options.stepIdentity;
    this.auditEnabled = options.auditEnabled ?? false;
    this.auditEmitter = options.auditEmitter ?? null;
    this.implicitInternalStepIdsPolicy =
      options.implicitInternalStepIds ?? "allow";
    this.declaredSignalIds = options.declaredSignalIds ?? null;
    this.assertLockOwnership = options.assertLockOwnership ?? (() => {});
    this.startWorkflowExecution =
      options.startWorkflowExecution ??
      (() =>
        durableExecutionInvariantError.throw({
          message: "Durable workflow starts are not available in this context.",
        }));
    this.getTaskPersistenceId =
      options.getTaskPersistenceId ?? ((task) => task.id);
    this.cancellationSignal =
      options.cancellationSignal ?? new AbortController().signal;

    this.audit = createDurableContextAudit({
      store: this.store,
      executionId: this.executionId,
      attempt: this.attempt,
      enabled: this.auditEnabled,
      emitter: this.auditEmitter,
    });

    this.determinism = createDurableContextDeterminism({
      policy: this.implicitInternalStepIdsPolicy,
      warnedKinds: this.implicitInternalStepIdsWarned,
      seenStepIds: this.seenStepIds,
      warn: console.warn,
    });

    this.state = createDurableStateOperations({
      store: this.store,
      executionId: this.executionId,
      assertCanWrite: async () => await this.assertCanContinue(),
      assertUniqueStepId: this.determinism.assertUniqueStepId,
      assertOrWarnImplicitInternalStepId:
        this.determinism.assertOrWarnImplicitInternalStepId,
      internalStep: (stepId) => this.internalStep(stepId),
    });
  }

  /**
   * Gate every durable operation must pass before it starts. Pause rejects
   * with the pause interruption so an attempt that ignores its abort signal
   * still cannot run further steps; `allowPaused` exists only for persisting
   * the result of a step body that had already finished when the pause
   * landed, which avoids repeating its side effect on resume.
   */
  private async assertCanContinue(
    options: {
      allowCancellationRequested?: boolean;
      allowPaused?: boolean;
    } = {},
  ): Promise<void> {
    this.assertLockOwnership();
    const exec = await this.store.getExecution(this.executionId);
    const cancellationRequested =
      exec?.status === ExecutionStatus.Cancelling ||
      exec?.cancelRequestedAt !== undefined;
    if (
      exec?.status === ExecutionStatus.Cancelled ||
      (cancellationRequested && !options.allowCancellationRequested)
    ) {
      durableContextCancelledError.throw({
        message: exec?.error?.message || "Execution cancelled",
      });
    }

    if (exec?.status === ExecutionStatus.Paused && !options.allowPaused) {
      throwDurablePauseInterruption();
    }
  }

  private getStepId(stepId: string | DurableStepId<unknown>): string {
    return typeof stepId === "string" ? stepId : stepId.id;
  }

  /** @internal Keeps integration writes under the active execution's lease. */
  _getStore(): IDurableStore {
    return this.store;
  }

  /** @internal Returns controls only within the active callback's async scope. */
  _currentStep(): DurableStepContext | undefined {
    return this.stepContext.getStore();
  }

  private internalStep<T>(
    stepId: string,
    options: StepOptions = {},
  ): StepBuilder<T> {
    return new StepBuilder<T>(this, stepId, options, true);
  }

  private resolveWorkflowStartOptions(
    stepId: string,
    options: WorkflowOptions | undefined,
  ) {
    return {
      timeout: options?.timeout,
      priority: options?.priority,
      parentExecutionId: this.executionId,
      idempotencyKey:
        options?.idempotencyKey ?? `subflow:${this.executionId}:${stepId}`,
    };
  }

  step<T>(stepId: string | DurableStepId<T>): IDurableStepBuilder<T>;
  step<T>(
    stepId: string | DurableStepId<T>,
    fn: (context: DurableStepContext) => Promise<T>,
  ): Promise<T>;
  step<T>(
    stepId: string | DurableStepId<T>,
    options: StepOptions,
    fn: (context: DurableStepContext) => Promise<T>,
  ): Promise<T>;
  step<TTask extends AnyTask>(
    stepId: string,
    task: TTask,
    ...args: ExtractTaskInput<TTask> extends undefined | void
      ? [input?: ExtractTaskInput<TTask>, options?: StepOptions]
      : [input: ExtractTaskInput<TTask>, options?: StepOptions]
  ): Promise<ResolveTaskOutput<TTask>>;
  step<T>(
    stepId: string | DurableStepId<T>,
    optionsOrFn?:
      | AnyTask
      | StepOptions
      | ((context: DurableStepContext) => Promise<T>),
    fnOrInput?: unknown,
    taskOptions?: StepOptions,
  ): IDurableStepBuilder<T> | Promise<any> {
    const resolvedStepId = this.getStepId(stepId);
    this.determinism.assertUserStepId(resolvedStepId);
    this.determinism.assertUniqueStepId(resolvedStepId);

    if (optionsOrFn === undefined) {
      return new StepBuilder<T>(this, resolvedStepId);
    }

    if (isStepTask(optionsOrFn)) {
      const task = optionsOrFn;
      return this._executeStep(
        resolvedStepId,
        taskOptions ?? {},
        async (step) => {
          if (!this.taskExecutor)
            return durableExecutionInvariantError.throw({
              message: "Task steps require a configured task executor.",
            });
          return await this.taskExecutor.run(task, fnOrInput, {
            signal: step.signal,
          });
        },
        undefined,
        undefined,
        false,
        this.getTaskKey(task),
      );
    }

    const fnToExecute =
      typeof optionsOrFn === "function" ? optionsOrFn : fnOrInput;
    const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
    if (typeof fnToExecute !== "function")
      return durableExecutionInvariantError.throw({
        message: "A durable step requires a callback or Runner task.",
      });
    return this._executeStep(resolvedStepId, options, (step) =>
      fnToExecute(step),
    );
  }

  async _executeStep<T>(
    stepId: string,
    options: StepOptions,
    upFn: (context: DurableStepContext) => Promise<T>,
    downFn?: (result: T) => Promise<void>,
    currentMeta?: DurableExecutionCurrentWorkflowMeta,
    allowCancellationRequested = false,
    historyTaskKey?: string,
  ): Promise<T> {
    return await this.journal.run(
      currentMeta
        ? "workflow"
        : stepId.startsWith("__state:")
          ? "state"
          : "step",
      stepId,
      () =>
        executeDurableStep({
          workflowAttempt: this.attempt,
          identityExecutionId: this.stepIdentity,
          store: this.store,
          executionId: this.executionId,
          assertCanContinue: async () =>
            await this.assertCanContinue({ allowCancellationRequested }),
          assertCanPersistResult: async () =>
            await this.assertCanContinue({
              allowCancellationRequested,
              allowPaused: true,
            }),
          appendAuditEntry: this.audit.append,
          setCurrent: async () =>
            await setExecutionCurrent(
              this.store,
              this.executionId,
              currentMeta
                ? createWorkflowStepCurrent({
                    stepId,
                    startedAt: new Date(),
                    meta: currentMeta,
                  })
                : createStepCurrent({
                    stepId,
                    startedAt: new Date(),
                  }),
            ),
          stepId,
          options,
          executionLockState: this.executionLockState,
          upFn: (step) =>
            this.journal.callback(stepId, () =>
              this.stepContext.run(step, () => upFn(step)),
            ),
          signal: this.cancellationSignal,
          downFn,
          compensations: this.compensations,
        }),
      historyTaskKey ?? currentMeta?.childWorkflowKey,
    );
  }

  /** @internal Names event call sites using the existing implicit-id policy. */
  _eventStepId(eventKey: string, explicit?: string): string {
    if (explicit) return `event:${explicit}`;
    this.determinism.assertOrWarnImplicitInternalStepId("emit");
    const index = this.eventIndexes.get(eventKey) ?? 0;
    this.eventIndexes.set(eventKey, index + 1);
    return `event:${eventKey}:${index}`;
  }

  /** @internal Runs a named compensation checkpoint during teardown. */
  async _compensate<T>(
    stepId: string,
    fn: (context: DurableStepContext) => Promise<T>,
  ): Promise<T> {
    this.determinism.assertUniqueStepId(stepId);
    return await this.internalStep<T>(stepId).up(fn);
  }

  async rollback(): Promise<void> {
    await rollbackDurableCompensations({
      store: this.store,
      executionId: this.executionId,
      compensations: this.compensations,
      assertUniqueStepId: this.determinism.assertUniqueStepId,
      internalStep: this.internalStep.bind(this),
    });
  }

  async continueAsNew<TInput>(
    nextInput: TInput,
    options?: ContinueAsNewOptions,
  ): Promise<never> {
    if (options?.version !== undefined)
      check(options.version, Match.Range({ min: 1, integer: true }));
    return this.journal.run("continue", "__continue", async () => {
      if (this.journal.replay) return this.journal.replay.effect();
      await this.assertCanContinue();
      const execution = await this.store.getExecution(this.executionId);
      if (!execution || execution.status !== ExecutionStatus.Running) {
        return durableContinueAsNewRejectedError.throw({
          executionId: this.executionId,
          reason: execution
            ? `execution is ${execution.status}`
            : "execution does not exist",
        });
      }

      throw new ContinuationSignal(nextInput, options);
    });
  }

  async setState<T extends object>(
    patch: Partial<T> & Record<string, unknown>,
    options?: DurableStateOptions,
  ): Promise<void> {
    await this.state.patch(patch, options);
  }

  async replaceState<T>(next: T, options?: DurableStateOptions): Promise<void> {
    await this.state.replace(next, options);
  }

  async getState<T>(options?: DurableStateOptions): Promise<T | undefined> {
    return await this.state.get<T>(options);
  }

  info(): DurableInfo {
    return {
      executionId: this.executionId,
      attempt: this.attempt,
      stepCount: this.seenStepIds.size,
    };
  }

  async sleep(durationMs: number, options?: SleepOptions): Promise<void> {
    assertFiniteDurationMs("sleep duration", durationMs);
    const historyId = `__sleep:${options?.stepId ?? this.sleepIndexRef.current}`;
    return await this.journal.run("sleep", historyId, () =>
      sleepDurably({
        store: this.store,
        executionId: this.executionId,
        assertCanContinue: this.assertCanContinue.bind(this),
        appendAuditEntry: this.audit.append,
        assertUniqueStepId: this.determinism.assertUniqueStepId,
        assertOrWarnImplicitInternalStepId:
          this.determinism.assertOrWarnImplicitInternalStepId,
        sleepIndexRef: this.sleepIndexRef,
        durationMs,
        options,
      }),
    );
  }

  async workflow<TTask extends AnyTask>(
    stepId: string,
    task: TTask,
    ...args: ExtractTaskInput<TTask> extends undefined | void
      ? [input?: ExtractTaskInput<TTask>, options?: WorkflowOptions]
      : [input: ExtractTaskInput<TTask>, options?: WorkflowOptions]
  ): Promise<string> {
    const [input, options] = args;

    if (!durableWorkflowTag.exists(task)) {
      return durableExecutionInvariantError.throw({
        message: `Task '${task.id}' is not tagged as a durable workflow and cannot be started via durableContext.workflow().`,
      });
    }

    return await this._executeStep(
      stepId,
      {},
      async () =>
        await this.startWorkflowExecution(
          task,
          input,
          this.resolveWorkflowStartOptions(stepId, options),
        ),
      undefined,
      {
        childWorkflowKey: this.getTaskPersistenceId(task),
      },
    );
  }

  async waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
    options?: SignalOptions & { timeoutMs?: never },
  ): Promise<Extract<WaitForSignalResult<TPayload>, { kind: "signal" }>>;
  async waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
    options: SignalOptions & { timeoutMs: number },
  ): Promise<WaitForSignalResult<TPayload>>;
  async waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
    options: SignalOptions,
  ): Promise<WaitForSignalResult<TPayload>>;
  async waitForSignal<TPayload>(
    signal: IEventDefinition<TPayload>,
    options?: SignalOptions,
  ): Promise<WaitForSignalResult<TPayload>> {
    if (
      this.declaredSignalIds !== null &&
      !this.declaredSignalIds.has(signal.id)
    ) {
      durableExecutionInvariantError.throw({
        message: `Signal '${signal.id}' is not declared in durableWorkflow.signals for this workflow.`,
      });
    }
    assertFiniteDurationMs("signal timeout", options?.timeoutMs);

    const historyId = createSignalWaitIdentity(
      signal.id,
      options,
      this.signalIndexes,
    );
    return await this.journal.run("signal", historyId, () =>
      waitForSignalDurably({
        store: this.store,
        executionId: this.executionId,
        assertCanContinue: this.assertCanContinue.bind(this),
        appendAuditEntry: this.audit.append,
        assertUniqueStepId: this.determinism.assertUniqueStepId,
        assertOrWarnImplicitInternalStepId:
          this.determinism.assertOrWarnImplicitInternalStepId,
        signalIndexes: this.signalIndexes,
        signal,
        options,
      }),
    );
  }

  async waitForExecution<TTask extends AnyTask>(
    _task: TTask,
    executionId: string,
  ): Promise<ResolveTaskOutput<TTask>>;
  async waitForExecution<TTask extends AnyTask>(
    _task: TTask,
    executionId: string,
    options: WaitForExecutionOptions & { timeoutMs: number },
  ): Promise<
    { kind: "completed"; data: ResolveTaskOutput<TTask> } | { kind: "timeout" }
  >;
  async waitForExecution<TTask extends AnyTask>(
    _task: TTask,
    executionId: string,
    options: WaitForExecutionOptions,
  ): Promise<ResolveTaskOutput<TTask>>;
  async waitForExecution<TTask extends AnyTask>(
    _task: TTask,
    executionId: string,
    options?: WaitForExecutionOptions,
  ): Promise<any> {
    assertFiniteDurationMs("execution-wait timeout", options?.timeoutMs);
    return await this.journal.run(
      "execution",
      createExecutionStepId(executionId, options),
      () =>
        waitForExecutionDurably<ResolveTaskOutput<TTask>>({
          store: this.store,
          executionId: this.executionId,
          targetExecutionId: executionId,
          expectedWorkflowKey: this.getTaskPersistenceId(_task),
          assertCanContinue: this.assertCanContinue.bind(this),
          assertUniqueStepId: this.determinism.assertUniqueStepId,
          options,
        }),
      this.getTaskPersistenceId(_task),
    );
  }

  async switch<TValue, TResult>(
    stepId: string,
    value: TValue,
    branches: SwitchBranch<TValue, TResult>[],
    fallbackBranch?: Omit<SwitchBranch<TValue, TResult>, "match">,
  ): Promise<TResult> {
    this.determinism.assertUserStepId(stepId);

    return await this.journal.run("switch", stepId, () =>
      switchDurably({
        store: this.store,
        executionId: this.executionId,
        assertCanContinue: this.assertCanContinue.bind(this),
        appendAuditEntry: this.audit.append,
        assertUniqueStepId: this.determinism.assertUniqueStepId,
        stepId,
        value,
        branches: branches.map((branch) => ({
          ...branch,
          run: (value: TValue) =>
            this.journal.callback(stepId, () => branch.run(value)),
        })),
        fallbackBranch: fallbackBranch
          ? {
              ...fallbackBranch,
              run: (value: TValue) =>
                this.journal.callback(stepId, () => fallbackBranch.run(value)),
            }
          : undefined,
      }),
    );
  }

  async note(message: string, meta?: Record<string, unknown>): Promise<void> {
    if (!this.audit.isEnabled()) return;

    const stepId = `__note:${this.noteIndex}`;
    this.noteIndex += 1;

    this.determinism.assertUniqueStepId(stepId);

    await this.internalStep<void>(stepId).up(async () => {
      await this.audit.append({
        kind: DurableAuditEntryKind.Note,
        message,
        meta,
      });
    });
  }
}
