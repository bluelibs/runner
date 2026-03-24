import type { IEventBus } from "./interfaces/bus";
import type {
  EmitOptions,
  IDurableContext,
  IStepBuilder,
  SignalOptions,
  SleepOptions,
  StepOptions,
  SwitchBranch,
  WaitForSignalResult,
  WaitForExecutionOptions,
  WorkflowOptions,
} from "./interfaces/context";
import type { IDurableStore } from "./interfaces/store";
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
  createDurableContextDeterminism,
  type ImplicitInternalStepIdsPolicy,
} from "./durable-context/DurableContext.determinism";
import type { DurableContextDeterminism } from "./durable-context/DurableContext.determinism";
import type { DurableContextAudit } from "./durable-context/DurableContext.audit";
import {
  executeDurableStep,
  rollbackDurableCompensations,
  type DurableCompensation,
} from "./durable-context/DurableContext.steps";
import { emitDurably } from "./durable-context/DurableContext.emit";
import { sleepDurably } from "./durable-context/DurableContext.sleep";
import { waitForExecutionDurably } from "./durable-context/DurableContext.waitForExecution";
import { waitForSignalDurably } from "./durable-context/DurableContext.waitForSignal";
import { switchDurably } from "./durable-context/DurableContext.switch";
import {
  durableContextCancelledError,
  durableExecutionInvariantError,
} from "../../../errors";
import { durableWorkflowTag } from "../tags/durableWorkflow.tag";

/**
 * Per-execution workflow toolkit used by durable tasks.
 *
 * `DurableContext` is created by `ExecutionManager` for each execution attempt and
 * made available to user code via `DurableResource.use()` (AsyncLocalStorage).
 *
 * It provides deterministic "save points" (`step()`), typed subflow starts
 * (`workflow()`), durable suspension primitives (`sleep()`, `waitForSignal()`,
 * `waitForExecution()`), and best-effort side-channel notifications (`emit()`).
 * The durable store is the source of truth; this class is intentionally thin state
 * around indexes/guards to keep a single in-memory attempt deterministic.
 */
export class DurableContext implements IDurableContext {
  private readonly sleepIndexRef = { current: 0 };
  private readonly signalIndexes = new Map<string, number>();
  private readonly emitIndexes = new Map<string, number>();
  private noteIndex = 0;

  private readonly implicitInternalStepIdsWarned = new Set<
    "sleep" | "emit" | "waitForSignal"
  >();

  // Track user and internal steps seen in this execution context instance
  private readonly seenStepIds = new Set<string>();

  private readonly compensations: DurableCompensation[] = [];

  private readonly audit: DurableContextAudit;
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

  constructor(
    private readonly store: IDurableStore,
    private readonly bus: IEventBus,
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
    } = {},
  ) {
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
  }

  private async assertNotCancelled(): Promise<void> {
    const exec = await this.store.getExecution(this.executionId);
    if (exec?.status === ExecutionStatus.Cancelled) {
      durableContextCancelledError.throw({
        message: exec.error?.message || "Execution cancelled",
      });
    }
  }

  private async assertCanContinue(): Promise<void> {
    this.assertLockOwnership();
    await this.assertNotCancelled();
  }

  private getStepId(stepId: string | DurableStepId<unknown>): string {
    return typeof stepId === "string" ? stepId : stepId.id;
  }

  private internalStep<T>(
    stepId: string,
    options: StepOptions = {},
  ): StepBuilder<T> {
    return new StepBuilder<T>(this, stepId, options);
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
  ): IStepBuilder<T> | Promise<T> {
    const resolvedStepId = this.getStepId(stepId);
    this.determinism.assertUserStepId(resolvedStepId);
    this.determinism.assertUniqueStepId(resolvedStepId);

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
    currentMeta?: DurableExecutionCurrentWorkflowMeta,
  ): Promise<T> {
    return await executeDurableStep({
      store: this.store,
      executionId: this.executionId,
      assertCanContinue: this.assertCanContinue.bind(this),
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
      upFn,
      downFn,
      compensations: this.compensations,
    });
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

  async sleep(durationMs: number, options?: SleepOptions): Promise<void> {
    return await sleepDurably({
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
    });
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

    return await waitForSignalDurably({
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
    });
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
    return await waitForExecutionDurably<ResolveTaskOutput<TTask>>({
      store: this.store,
      executionId: this.executionId,
      targetExecutionId: executionId,
      expectedWorkflowKey: this.getTaskPersistenceId(_task),
      assertCanContinue: this.assertCanContinue.bind(this),
      assertUniqueStepId: this.determinism.assertUniqueStepId,
      options,
    });
  }

  async emit<TPayload>(
    event: IEventDefinition<TPayload>,
    payload: TPayload,
    options?: EmitOptions,
  ): Promise<void> {
    return await emitDurably({
      bus: this.bus,
      assertCanContinue: this.assertCanContinue.bind(this),
      appendAuditEntry: this.audit.append,
      assertUniqueStepId: this.determinism.assertUniqueStepId,
      assertOrWarnImplicitInternalStepId:
        this.determinism.assertOrWarnImplicitInternalStepId,
      emitIndexes: this.emitIndexes,
      internalStep: this.internalStep.bind(this),
      event,
      payload,
      options,
    });
  }

  async switch<TValue, TResult>(
    stepId: string,
    value: TValue,
    branches: SwitchBranch<TValue, TResult>[],
    fallbackBranch?: Omit<SwitchBranch<TValue, TResult>, "match">,
  ): Promise<TResult> {
    this.determinism.assertUserStepId(stepId);

    return await switchDurably({
      store: this.store,
      executionId: this.executionId,
      assertCanContinue: this.assertCanContinue.bind(this),
      appendAuditEntry: this.audit.append,
      assertUniqueStepId: this.determinism.assertUniqueStepId,
      stepId,
      value,
      branches,
      fallbackBranch,
    });
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
