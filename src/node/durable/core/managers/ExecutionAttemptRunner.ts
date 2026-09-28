import type { IDurableStore } from "../interfaces/store";
import type { IEventBus } from "../interfaces/bus";
import type {
  DurableServiceConfig,
  ITaskExecutor,
} from "../interfaces/service";
import type { ITask } from "../../../../types/task";
import type { ContinueAsNewOptions } from "../interfaces/context";
import { ExecutionStatus, isExecutionTerminal, type Execution } from "../types";
import type { TaskRegistry } from "./TaskRegistry";
import type { AuditLogger } from "./AuditLogger";
import type { DurableContext } from "../DurableContext";
import { acquireStoreLock } from "../locking";
import { sleepMs } from "../utils";
import {
  type ExecutionLockState,
  createExecutionLockState,
  assertStoreLockOwnership,
  startLockHeartbeat,
} from "./ExecutionManager.locking";
import {
  type ExecutionCancellationState,
  getCancellationState,
  finalizeCancellationIfRequested,
  transitionRunningExecutionToCancelled as transitionRunningToCancelledFn,
} from "./ExecutionManager.cancellation";
import {
  transitionExecutionToRunning as transitionToRunningFn,
  transitionExecutionToFailed as transitionToFailedFn,
  completeExecutionAttempt as completeAttemptFn,
  suspendExecutionAttempt as suspendAttemptFn,
  scheduleExecutionRetry as scheduleRetryFn,
} from "./ExecutionManager.transitions";
import {
  type ExecutionAttemptGuards,
  type TaskAttemptOutcome,
  type ExecutionErrorInfo,
  createExecutionAttemptGuards as createGuardsFn,
  createExecutionContext as createContextFn,
  runTaskAttempt as runTaskAttemptFn,
  handleExecutionAttemptError as handleAttemptErrorFn,
  toExecutionErrorInfo,
} from "./ExecutionManager.attempt";
import { ValidationHelper } from "../../../../models/middleware/ValidationHelper";
import {
  logExecutionStatusChange,
  type ExecutionPersistenceDeps,
} from "./ExecutionManager.persistence";
import { continueExecutionAsNew as continueAsNewFlow } from "./ExecutionManager.continueAsNew";
import type { AttemptCancellationController } from "./AttemptCancellationController";
import { WorkflowAdmissionController } from "./WorkflowAdmissionController";
import { redriveIfResumedDuringLock } from "./ExecutionAttemptRunner.redrive";

type AnyTask = ITask<any, Promise<any>, any, any, any, any>;

export interface ExecutionAttemptRunnerDeps {
  store: IDurableStore;
  eventBus: IEventBus;
  taskRegistry: TaskRegistry;
  auditLogger: AuditLogger;
  cancellation: AttemptCancellationController;
  taskExecutor?: ITaskExecutor;
  contextProvider?: DurableServiceConfig["contextProvider"];
  audit?: DurableServiceConfig["audit"];
  determinism?: DurableServiceConfig["determinism"];
  notifyFinished: (execution: Execution) => Promise<void>;
  startExecution: (
    task: AnyTask,
    input: unknown,
    options?: { parentExecutionId?: string },
  ) => Promise<string>;
  getTaskWorkflowKey: (task: AnyTask) => string;
  assertTaskExecutorConfigured: () => void;
  persistence: ExecutionPersistenceDeps;
}

/**
 * Runs a single durable execution attempt under a store lock: acquires the
 * lock, resolves the workflow task, transitions the execution through
 * running/completed/failed/sleeping/retrying, and interprets suspension and
 * cancellation. Split from {@link ExecutionManager} so the coordinator only
 * owns the public service API and wiring.
 */
export class ExecutionAttemptRunner {
  private readonly workflowAdmission: WorkflowAdmissionController;

  constructor(private readonly deps: ExecutionAttemptRunnerDeps) {
    this.workflowAdmission = new WorkflowAdmissionController(deps.store);
  }

  async processExecution(executionId: string): Promise<void> {
    const snapshot = await this.deps.store.getExecution(executionId);
    if (!snapshot) return;
    if (isExecutionTerminal(snapshot.status)) return;
    // Paused executions ignore stale queue messages and timer kicks until
    // resume restores their pre-pause status and re-kicks them.
    if (snapshot.status === ExecutionStatus.Paused) return;

    const lockResource = `execution:${executionId}`;
    const lockTtlMs = 30_000;
    const acquiredLock = await acquireStoreLock({
      store: this.deps.store,
      resource: lockResource,
      ttlMs: lockTtlMs,
      sleep: sleepMs,
    });

    if (acquiredLock === null) return;

    const lockState = createExecutionLockState();
    lockState.lockId = acquiredLock.lockId;
    lockState.lockResource = lockResource;
    lockState.lockTtlMs = lockTtlMs;
    const stopHeartbeat = startLockHeartbeat({
      store: this.deps.store,
      lockResource,
      lockId: acquiredLock.lockId,
      lockTtlMs,
      lockState,
    });

    let lockedSnapshot: Execution<unknown, unknown> | null;
    try {
      lockedSnapshot = await this.runUnderExecutionLock(executionId, lockState);
    } finally {
      stopHeartbeat();
      await acquiredLock.release();
    }

    await redriveIfResumedDuringLock({
      store: this.deps.store,
      lockedSnapshot,
      lockState,
      shutdownInterruptionReason:
        this.deps.cancellation.getShutdownInterruptionReason(),
      kickoffExecution: this.deps.persistence.kickoffExecution,
    });
  }

  /**
   * Body of {@link processExecution} while the execution lock is held.
   * Returns the record read right after acquiring the lock so the caller can
   * tell whether a pause/resume happened during its tenure.
   */
  private async runUnderExecutionLock(
    executionId: string,
    lockState: ExecutionLockState,
  ): Promise<Execution<unknown, unknown> | null> {
    const snapshot = await this.deps.store.getExecution(executionId);
    if (!snapshot) return null;
    if (isExecutionTerminal(snapshot.status)) return snapshot;
    if (snapshot.status === ExecutionStatus.Paused) return snapshot;

    if (!snapshot.workflowKey) {
      await this.transitionExecutionToFailed({
        execution: snapshot,
        from: snapshot.status,
        reason: "workflow_key_missing",
        error: { message: "Execution is missing its durable workflow key." },
      });
      return snapshot;
    }

    const task = this.deps.taskRegistry.find(snapshot.workflowKey);
    if (!task) {
      await this.transitionExecutionToFailed({
        execution: snapshot,
        from: snapshot.status,
        reason: "task_not_registered",
        error: {
          message: `Task not registered for workflow key: ${snapshot.workflowKey}`,
        },
      });
      return snapshot;
    }

    let execution = snapshot;
    if (execution.inputNeedsValidation) {
      const validated = await this.validateDeferredExecutionInput({
        execution,
        task,
      });
      if (!validated) {
        return snapshot;
      }
      execution = validated;
    }

    const admission = await this.workflowAdmission.tryAdmit({
      task,
      workflowKey: execution.workflowKey,
      executionLockState: lockState,
    });
    if (admission.kind === "deferred") {
      await this.workflowAdmission.defer(execution.id, admission.retryAfterMs);
      return snapshot;
    }

    try {
      await this.runExecutionAttempt(
        execution,
        task,
        lockState,
        admission.assertOwnership,
      );
    } finally {
      await admission.release();
    }
    return snapshot;
  }

  async runExecutionAttempt(
    execution: Execution<unknown, unknown>,
    task: AnyTask,
    executionLockState: ExecutionLockState,
    assertAdmissionOwnership?: () => Promise<void>,
  ): Promise<void> {
    const guards = this.createExecutionAttemptGuards(
      execution.id,
      executionLockState,
      assertAdmissionOwnership,
    );
    guards.assertLockOwnership();

    // Only resume owns the paused → runnable transition; a stale direct caller
    // must never flip a paused execution back to running.
    if (execution.status === ExecutionStatus.Paused) return;

    const initialCancellation = await guards.getCancellationState();
    if (initialCancellation) {
      if (
        execution.status === ExecutionStatus.Running ||
        execution.status === ExecutionStatus.Cancelling
      ) {
        await this.transitionRunningExecutionToCancelled({
          execution,
          reason: initialCancellation.reason,
          canPersistOutcome: guards.canPersistOutcome,
        });
      }
      return;
    }

    this.deps.assertTaskExecutorConfigured();

    const runningExecution =
      (await this.transitionExecutionToRunning(execution)) ?? null;
    if (!runningExecution) return;

    const attemptCancellation =
      await this.deps.cancellation.registerAttemptCancellation({
        executionId: runningExecution.id,
        pausedAt: runningExecution.pausedAt,
      });

    const context = this.createExecutionContext(
      runningExecution,
      task,
      guards.assertLockOwnership,
      attemptCancellation.signal,
    );

    try {
      const outcome = await this.runTaskAttempt({
        task,
        input: runningExecution.input,
        context,
        execution: runningExecution,
        raceWithLockLoss: guards.raceWithLockLoss,
        canPersistOutcome: guards.canPersistOutcome,
        abortAttempt: (reason) =>
          this.deps.cancellation.abortActiveAttempt(
            runningExecution.id,
            reason,
          ),
      });
      if (outcome.kind === "already-finalized") return;

      const cancellationState = await guards.getCancellationState();
      if (cancellationState) {
        await this.transitionRunningExecutionToCancelled({
          execution: runningExecution,
          reason: cancellationState.reason,
          canPersistOutcome: guards.canPersistOutcome,
        });
        return;
      }

      await this.completeExecutionAttempt(
        runningExecution,
        outcome.result,
        guards.canPersistOutcome,
      );
    } catch (error) {
      await this.handleExecutionAttemptError({
        error,
        runningExecution,
        guards,
        executionLockState,
      });
    } finally {
      attemptCancellation.stop();
    }
  }

  async assertStoreLockOwnership(lockState: ExecutionLockState): Promise<void> {
    await assertStoreLockOwnership({ store: this.deps.store, lockState });
  }

  createExecutionContext(
    execution: Execution<unknown, unknown>,
    task: AnyTask,
    assertLockOwnership: () => void,
    cancellationSignal: AbortSignal,
  ): DurableContext {
    return createContextFn({
      store: this.deps.store,
      eventBus: this.deps.eventBus,
      execution,
      task,
      assertLockOwnership,
      cancellationSignal,
      auditConfig: this.deps.audit,
      determinismConfig: this.deps.determinism,
      startExecution: (childTask, input, options) =>
        this.deps.startExecution(childTask, input, options),
      getTaskWorkflowKey: (t) => this.deps.getTaskWorkflowKey(t),
    });
  }

  async runTaskAttempt(params: {
    task: AnyTask;
    input: unknown;
    context: DurableContext;
    execution: Execution<unknown, unknown>;
    raceWithLockLoss: <T>(promise: Promise<T>) => Promise<T>;
    canPersistOutcome: () => Promise<boolean>;
    abortAttempt: (reason: string) => void;
  }): Promise<TaskAttemptOutcome> {
    this.deps.assertTaskExecutorConfigured();
    return runTaskAttemptFn({
      ...params,
      taskExecutor: this.deps.taskExecutor!,
      contextProvider: this.deps.contextProvider,
      transitionToFailed: (p) => this.transitionExecutionToFailed(p),
    });
  }

  async transitionExecutionToRunning(
    execution: Execution<unknown, unknown>,
  ): Promise<Execution<unknown, unknown> | null> {
    return transitionToRunningFn({
      store: this.deps.store,
      execution,
      logStatusChange: (p) => this.logStatusChange(p),
    });
  }

  /**
   * Validates input that crossed runtimes unchecked (a restart override
   * issued where the task is unknown, or a continue-as-new payload).
   * Invalid input fails the execution without running user code; valid or
   * unschema'd input clears the flag so later attempts run unchecked.
   */
  private async validateDeferredExecutionInput(params: {
    execution: Execution<unknown, unknown>;
    task: AnyTask;
  }): Promise<Execution<unknown, unknown> | null> {
    try {
      ValidationHelper.validateInput(
        params.execution.input,
        params.task.inputSchema,
        params.execution.workflowKey,
        "Task",
      );
    } catch (error) {
      await this.transitionExecutionToFailed({
        execution: params.execution,
        from: params.execution.status,
        reason: "invalid_input",
        error: toExecutionErrorInfo(error),
      });
      return null;
    }
    // Best-effort clear: a lost race just means the next attempt revalidates
    // the same (valid) input and clears the flag then. The cleared record is
    // returned so later transitions in this attempt don't resurrect the flag
    // from their stale snapshot.
    const cleared: Execution<unknown, unknown> = {
      ...params.execution,
      inputNeedsValidation: undefined,
      updatedAt: new Date(),
    };
    await this.deps.store.saveExecutionIfStatus(cleared, [
      params.execution.status,
    ]);
    return cleared;
  }

  async transitionExecutionToFailed(params: {
    execution: Execution<unknown, unknown>;
    from: ExecutionStatus;
    reason:
      | "failed"
      | "timed_out"
      | "workflow_key_missing"
      | "task_not_registered"
      | "invalid_input"
      | "delivery_attempts_exhausted";
    error: { message: string; stack?: string; stepId?: string };
  }): Promise<void> {
    await transitionToFailedFn({
      store: this.deps.store,
      ...params,
      logStatusChange: (p) => this.logStatusChange(p),
      notifyFinished: (e) => this.deps.notifyFinished(e),
      finalizeCancellation: (exec, can) =>
        this.finalizeCancellationIfRequested(exec, can),
    });
  }

  async completeExecutionAttempt(
    execution: Execution<unknown, unknown>,
    result: unknown,
    canPersistOutcome?: () => Promise<boolean>,
  ): Promise<void> {
    await completeAttemptFn({
      store: this.deps.store,
      execution,
      result,
      canPersistOutcome,
      logStatusChange: (p) => this.logStatusChange(p),
      notifyFinished: (e) => this.deps.notifyFinished(e),
      finalizeCancellation: (exec, can) =>
        this.finalizeCancellationIfRequested(exec, can),
    });
  }

  async suspendExecutionAttempt(
    execution: Execution<unknown, unknown>,
    reason: string,
    canPersistOutcome?: () => Promise<boolean>,
  ): Promise<void> {
    await suspendAttemptFn({
      store: this.deps.store,
      execution,
      reason,
      canPersistOutcome,
      logStatusChange: (p) => this.logStatusChange(p),
      finalizeCancellation: (exec, can) =>
        this.finalizeCancellationIfRequested(exec, can),
    });
  }

  async scheduleExecutionRetry(params: {
    runningExecution: Execution<unknown, unknown>;
    error: ExecutionErrorInfo;
    canPersistOutcome?: () => Promise<boolean>;
  }): Promise<void> {
    await scheduleRetryFn({
      store: this.deps.store,
      ...params,
      logStatusChange: (p) => this.logStatusChange(p),
      finalizeCancellation: (exec, can) =>
        this.finalizeCancellationIfRequested(exec, can),
    });
  }

  async continueExecutionAsNew(params: {
    runningExecution: Execution<unknown, unknown>;
    nextInput: unknown;
    options?: ContinueAsNewOptions;
    canPersistOutcome?: () => Promise<boolean>;
  }): Promise<void> {
    await continueAsNewFlow({
      deps: {
        persistence: this.deps.persistence,
        notifyFinished: (e) => this.deps.notifyFinished(e),
      },
      ...params,
      logStatusChange: (p) => this.logStatusChange(p),
      finalizeCancellation: (exec, can) =>
        this.finalizeCancellationIfRequested(exec, can),
    });
  }

  private async transitionRunningExecutionToCancelled(params: {
    execution: Execution<unknown, unknown>;
    reason: string;
    canPersistOutcome?: () => Promise<boolean>;
  }): Promise<void> {
    await transitionRunningToCancelledFn({
      store: this.deps.store,
      ...params,
      logStatusChange: (p) => this.logStatusChange(p),
      notifyFinished: (e) => this.deps.notifyFinished(e),
    });
  }

  private async finalizeCancellationIfRequested(
    execution: Execution<unknown, unknown>,
    canPersistOutcome?: () => Promise<boolean>,
  ): Promise<boolean> {
    return finalizeCancellationIfRequested({
      store: this.deps.store,
      executionId: execution.id,
      canPersistOutcome,
      transitionToCancelled: (p) =>
        this.transitionRunningExecutionToCancelled(p),
    });
  }

  private createExecutionAttemptGuards(
    executionId: string,
    lockState: ExecutionLockState,
    assertAdmissionOwnership?: () => Promise<void>,
  ): ExecutionAttemptGuards {
    return createGuardsFn({
      executionId,
      lockState,
      store: this.deps.store,
      assertStoreLockOwnership: async (ls) => {
        await this.assertStoreLockOwnership(ls);
        await assertAdmissionOwnership?.();
      },
      getCancellationState: (exec) => this.getCancellationState(exec),
    });
  }

  private getCancellationState(
    execution: Execution<unknown, unknown> | null,
  ): ExecutionCancellationState | null {
    return getCancellationState(execution);
  }

  private async handleExecutionAttemptError(params: {
    error: unknown;
    runningExecution: Execution<unknown, unknown>;
    guards: ExecutionAttemptGuards;
    executionLockState: ExecutionLockState;
  }): Promise<void> {
    await handleAttemptErrorFn({
      ...params,
      getShutdownInterruptionReason: () =>
        this.deps.cancellation.getShutdownInterruptionReason(),
      transitionToCancelled: (p) =>
        this.transitionRunningExecutionToCancelled(p),
      transitionToFailed: (p) => this.transitionExecutionToFailed(p),
      suspendAttempt: (exec, reason, can) =>
        this.suspendExecutionAttempt(exec, reason, can),
      scheduleRetry: (p) => this.scheduleExecutionRetry(p),
      continueAsNew: (p) => this.continueExecutionAsNew(p),
    });
  }

  private async logStatusChange(params: {
    execution: Execution<unknown, unknown>;
    from: ExecutionStatus | null;
    to: ExecutionStatus;
    reason: string;
  }): Promise<void> {
    await logExecutionStatusChange(this.deps.auditLogger, params);
  }
}
