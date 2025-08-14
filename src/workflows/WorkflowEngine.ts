/**
 * Workflow engine implementation for BlueLibs Runner.
 * 
 * This engine manages the execution of durable workflows with features including:
 * - State transitions based on transition schematics
 * - Rollback capabilities
 * - Time-based triggers and timeouts
 * - Parallel step execution
 * - Distributed execution via adapters
 */

import { EventManager } from "../models/EventManager";
import { Logger } from "../models/Logger";
import { Queue } from "../models/Queue";
import { ValidationError } from "../errors";
import {
  IWorkflowEngine,
  IWorkflowDefinition,
  IWorkflowInstance,
  IWorkflowExecution,
  IWorkflowAdapter,
  IWorkflowEngineOptions,
  IStepExecutionResult,
  WorkflowInstanceId,
  WorkflowState,
  WorkflowStatus,
  WorkflowContext,
  IWorkflowStep,
  IWorkflowTransition,
  IWorkflowTimer,
} from "./defs";

/**
 * Main workflow engine implementation
 */
export class WorkflowEngine implements IWorkflowEngine {
  private workflows = new Map<string, IWorkflowDefinition>();
  private activeTimers = new Map<string, NodeJS.Timeout>();
  private executionQueues = new Map<WorkflowInstanceId, Queue>();
  private options: Required<IWorkflowEngineOptions>;

  constructor(
    options: IWorkflowEngineOptions,
    private readonly eventManager: EventManager,
    private readonly logger: Logger
  ) {
    this.options = {
      defaultStepTimeout: 30000,
      defaultRetries: 3,
      enableParallelExecution: true,
      timerCheckInterval: 1000,
      ...options,
    };

    // Start timer processing
    this.startTimerProcessor();
  }

  /**
   * Register a workflow definition
   */
  async registerWorkflow(definition: IWorkflowDefinition): Promise<void> {
    this.validateWorkflowDefinition(definition);
    this.workflows.set(definition.id, definition);
    
    this.logger.info("Workflow registered", {
      workflowId: definition.id,
      name: definition.name,
      statesCount: definition.states.length,
      stepsCount: definition.steps.length,
      transitionsCount: definition.transitions.length,
    });
  }

  /**
   * Create a new workflow instance
   */
  async createInstance<TContext extends WorkflowContext = WorkflowContext>(
    workflowId: string,
    context: TContext,
    instanceId?: WorkflowInstanceId
  ): Promise<IWorkflowInstance<TContext>> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow with ID ${workflowId} not found`);
    }

    // Validate context if schema is provided
    if (workflow.contextSchema) {
      try {
        context = workflow.contextSchema.parse(context) as TContext;
      } catch (error) {
        throw new ValidationError("Workflow context", workflowId, error instanceof Error ? error : new Error(String(error)));
      }
    }

    const id = instanceId || this.generateInstanceId();
    const now = new Date();

    const instance: IWorkflowInstance<TContext> = {
      id,
      workflowId,
      currentState: workflow.initialState,
      status: WorkflowStatus.PENDING,
      context,
      executionHistory: [],
      activeTimers: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.options.adapter.saveInstance(instance);
    
    // Set up timers for this instance
    await this.setupTimers(instance);
    
    // Emit event
    if (workflow.events?.stateChanged) {
      await this.eventManager.emit(workflow.events.stateChanged, {
        instanceId: id,
        from: "",
        to: workflow.initialState,
        context,
      }, "workflow.engine");
    }

    this.logger.info("Workflow instance created", {
      instanceId: id,
      workflowId,
      initialState: workflow.initialState,
    });

    return instance;
  }

  /**
   * Execute a workflow step
   */
  async executeStep(
    instanceId: WorkflowInstanceId,
    stepId: string,
    input?: any
  ): Promise<IStepExecutionResult> {
    const instance = await this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance ${instanceId} not found`);
    }

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) {
      throw new Error(`Workflow definition ${instance.workflowId} not found`);
    }

    const step = workflow.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found in workflow ${instance.workflowId}`);
    }

    // Get or create execution queue for this instance
    let queue = this.executionQueues.get(instanceId);
    if (!queue) {
      queue = new Queue();
      this.executionQueues.set(instanceId, queue);
    }

    // Execute step in queue to ensure serialization
    return queue.run(async (signal) => {
      return this.executeStepInternal(instance, step, input, signal);
    });
  }

  /**
   * Transition workflow to a new state
   */
  async transitionTo(
    instanceId: WorkflowInstanceId,
    targetState: WorkflowState,
    stepOutputs?: Record<string, any>
  ): Promise<boolean> {
    const instance = await this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance ${instanceId} not found`);
    }

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) {
      throw new Error(`Workflow definition ${instance.workflowId} not found`);
    }

    // Find valid transition
    const transition = workflow.transitions.find(
      t => t.from === instance.currentState && t.to === targetState
    );

    if (!transition) {
      this.logger.warn("Invalid state transition attempted", {
        instanceId,
        from: instance.currentState,
        to: targetState,
      });
      return false;
    }

    // Check transition condition if provided
    if (transition.condition) {
      const conditionMet = await transition.condition(instance.context, stepOutputs);
      if (!conditionMet) {
        this.logger.info("Transition condition not met", {
          instanceId,
          from: instance.currentState,
          to: targetState,
        });
        return false;
      }
    }

    // Execute transition steps if any
    if (transition.steps && transition.steps.length > 0) {
      for (const stepId of transition.steps) {
        const stepInput = stepOutputs ? stepOutputs[stepId] : undefined;
        const result = await this.executeStep(instanceId, stepId, stepInput);
        
        if (!result.success) {
          this.logger.error("Transition step failed", {
            data: {
              instanceId,
              stepId,
              errorMessage: result.error?.message,
            },
            error: result.error,
          });
          return false;
        }
      }
    }

    // Update instance state
    const oldState = instance.currentState;
    instance.currentState = targetState;
    instance.updatedAt = new Date();

    // Check if workflow is completed
    if (workflow.finalStates && workflow.finalStates.includes(targetState)) {
      instance.status = WorkflowStatus.COMPLETED;
      instance.completedAt = new Date();
      
      // Clear timers
      await this.clearTimers(instanceId);
    }

    await this.options.adapter.updateInstance(instance);

    // Emit state change event
    if (workflow.events?.stateChanged) {
      await this.eventManager.emit(workflow.events.stateChanged, {
        instanceId,
        from: oldState,
        to: targetState,
        context: instance.context,
      }, "workflow.engine");
    }

    this.logger.info("Workflow state transition completed", {
      instanceId,
      from: oldState,
      to: targetState,
    });

    return true;
  }

  /**
   * Start rollback process for a workflow
   */
  async rollback(
    instanceId: WorkflowInstanceId,
    targetState?: WorkflowState
  ): Promise<boolean> {
    const instance = await this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance ${instanceId} not found`);
    }

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) {
      throw new Error(`Workflow definition ${instance.workflowId} not found`);
    }

    // Determine target state for rollback
    const rollbackToState = targetState || workflow.initialState;
    
    // Set status to rollback
    instance.status = WorkflowStatus.ROLLBACK;
    instance.updatedAt = new Date();
    await this.options.adapter.updateInstance(instance);

    // Emit rollback started event
    if (workflow.events?.rollbackStarted) {
      await this.eventManager.emit(workflow.events.rollbackStarted, {
        instanceId,
        fromState: instance.currentState,
        context: instance.context,
      }, "workflow.engine");
    }

    try {
      // Execute rollback steps in reverse order
      const executions = await this.options.adapter.loadExecutions(instanceId);
      const rollbackableExecutions = executions
        .filter(e => e.status === 'completed' && !e.isRollback)
        .reverse();

      for (const execution of rollbackableExecutions) {
        const step = workflow.steps.find(s => s.id === execution.stepId);
        if (step?.rollbackTask && step.config?.rollbackable !== false) {
          await this.executeRollbackStep(instance, step, execution);
        }
      }

      // Update to target state
      instance.currentState = rollbackToState;
      instance.status = WorkflowStatus.PENDING;
      instance.updatedAt = new Date();
      await this.options.adapter.updateInstance(instance);

      // Emit rollback completed event
      if (workflow.events?.rollbackCompleted) {
        await this.eventManager.emit(workflow.events.rollbackCompleted, {
          instanceId,
          toState: rollbackToState,
          context: instance.context,
        }, "workflow.engine");
      }

      this.logger.info("Workflow rollback completed", {
        instanceId,
        toState: rollbackToState,
      });

      return true;
    } catch (error) {
      // Set status to failed
      instance.status = WorkflowStatus.FAILED;
      instance.error = {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
      instance.updatedAt = new Date();
      await this.options.adapter.updateInstance(instance);

      this.logger.error("Workflow rollback failed", {
        data: {
          instanceId,
        },
        error: error instanceof Error ? error : new Error(String(error)),
      });

      return false;
    }
  }

  /**
   * Cancel a workflow instance
   */
  async cancel(instanceId: WorkflowInstanceId, reason?: string): Promise<void> {
    const instance = await this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance ${instanceId} not found`);
    }

    instance.status = WorkflowStatus.CANCELLED;
    instance.updatedAt = new Date();
    if (reason) {
      instance.error = { message: reason };
    }

    await this.options.adapter.updateInstance(instance);
    await this.clearTimers(instanceId);

    // Clean up execution queue
    const queue = this.executionQueues.get(instanceId);
    if (queue) {
      await queue.dispose({ cancel: true });
      this.executionQueues.delete(instanceId);
    }

    this.logger.info("Workflow instance cancelled", {
      instanceId,
      reason,
    });
  }

  /**
   * Get workflow instance by ID
   */
  async getInstance(instanceId: WorkflowInstanceId): Promise<IWorkflowInstance | null> {
    return this.options.adapter.loadInstance(instanceId);
  }

  /**
   * Get execution history for an instance
   */
  async getExecutionHistory(instanceId: WorkflowInstanceId): Promise<IWorkflowExecution[]> {
    return this.options.adapter.loadExecutions(instanceId);
  }

  /**
   * Check and process expired timers
   */
  async processTimers(): Promise<void> {
    // This is called periodically by the timer processor
    for (const workflow of this.workflows.values()) {
      if (!workflow.timers) continue;

      const instances = await this.options.adapter.findInstances({
        workflowId: workflow.id,
        status: WorkflowStatus.RUNNING,
      });

      for (const instance of instances) {
        await this.checkInstanceTimers(instance, workflow);
      }
    }
  }

  /**
   * Cleanup expired or completed instances
   */
  async cleanup(olderThan?: Date): Promise<number> {
    const cutoffDate = olderThan || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    
    if (this.options.adapter.cleanup) {
      return this.options.adapter.cleanup(cutoffDate);
    }
    
    return 0;
  }

  /**
   * Dispose the workflow engine
   */
  async dispose(): Promise<void> {
    // Clear all timers
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();

    // Dispose all execution queues
    for (const queue of this.executionQueues.values()) {
      await queue.dispose();
    }
    this.executionQueues.clear();

    this.logger.info("Workflow engine disposed");
  }

  /**
   * Execute a step internally
   */
  private async executeStepInternal(
    instance: IWorkflowInstance,
    step: IWorkflowStep,
    input: any,
    signal: AbortSignal
  ): Promise<IStepExecutionResult> {
    const executionId = this.generateExecutionId();
    const execution: IWorkflowExecution = {
      id: executionId,
      stepId: step.id,
      fromState: instance.currentState,
      toState: instance.currentState,
      input,
      status: 'running',
      startedAt: new Date(),
    };

    try {
      // Validate input if schema is provided
      if (step.inputSchema) {
        try {
          input = step.inputSchema.parse(input);
        } catch (error) {
          throw new ValidationError("Step input", step.id, error instanceof Error ? error : new Error(String(error)));
        }
      }

      // Save execution start
      await this.options.adapter.saveExecution(instance.id, execution);

      // Execute the step task with timeout and retries
      const maxRetries = step.config?.retries ?? this.options.defaultRetries;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          signal.throwIfAborted();

          const timeout = step.config?.timeout ?? this.options.defaultStepTimeout;
          let result = await this.executeWithTimeout(
            () => step.task.run(input, {}),
            timeout,
            signal
          );

          // Validate output if schema is provided
          if (step.outputSchema) {
            try {
              result = step.outputSchema.parse(result);
            } catch (error) {
              throw new ValidationError("Step output", step.id, error instanceof Error ? error : new Error(String(error)));
            }
          }

          // Update execution record
          execution.status = 'completed';
          execution.completedAt = new Date();
          execution.output = result;
          execution.retryAttempt = attempt;
          await this.options.adapter.saveExecution(instance.id, execution);

          // Emit step completed event
          const workflow = this.workflows.get(instance.workflowId);
          if (workflow?.events?.stepCompleted) {
            await this.eventManager.emit(workflow.events.stepCompleted, {
              instanceId: instance.id,
              stepId: step.id,
              output: result,
              context: instance.context,
            }, "workflow.engine");
          }

          this.logger.info("Step executed successfully", {
            instanceId: instance.id,
            stepId: step.id,
            attempt,
          });

          return {
            success: true,
            output: result,
            shouldContinue: true,
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          
          if (attempt < maxRetries) {
            this.logger.warn("Step execution failed, retrying", {
              data: {
                instanceId: instance.id,
                stepId: step.id,
                attempt,
              },
              error: lastError,
            });
            
            // Wait before retry (exponential backoff)
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // All retries exhausted
      execution.status = 'failed';
      execution.completedAt = new Date();
      execution.error = {
        message: lastError!.message,
        stack: lastError!.stack,
      };
      await this.options.adapter.saveExecution(instance.id, execution);

      // Emit step failed event
      const workflow = this.workflows.get(instance.workflowId);
      if (workflow?.events?.stepFailed) {
        await this.eventManager.emit(workflow.events.stepFailed, {
          instanceId: instance.id,
          stepId: step.id,
          error: lastError!,
          context: instance.context,
        }, "workflow.engine");
      }

      this.logger.error("Step execution failed after all retries", {
        data: {
          instanceId: instance.id,
          stepId: step.id,
        },
        error: lastError!,
      });

      return {
        success: false,
        error: lastError!,
        shouldContinue: false,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      execution.status = 'failed';
      execution.completedAt = new Date();
      execution.error = {
        message: err.message,
        stack: err.stack,
      };
      await this.options.adapter.saveExecution(instance.id, execution);

      return {
        success: false,
        error: err,
        shouldContinue: false,
      };
    }
  }

  /**
   * Execute a rollback step
   */
  private async executeRollbackStep(
    instance: IWorkflowInstance,
    step: IWorkflowStep,
    originalExecution: IWorkflowExecution
  ): Promise<void> {
    if (!step.rollbackTask) {
      return;
    }

    const executionId = this.generateExecutionId();
    const execution: IWorkflowExecution = {
      id: executionId,
      stepId: step.id,
      fromState: instance.currentState,
      toState: instance.currentState,
      input: originalExecution.output,
      status: 'running',
      startedAt: new Date(),
      isRollback: true,
    };

    try {
      await this.options.adapter.saveExecution(instance.id, execution);

      await step.rollbackTask.run(originalExecution.output, {});

      execution.status = 'completed';
      execution.completedAt = new Date();
      await this.options.adapter.saveExecution(instance.id, execution);

      this.logger.info("Rollback step executed", {
        instanceId: instance.id,
        stepId: step.id,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      execution.status = 'failed';
      execution.completedAt = new Date();
      execution.error = {
        message: err.message,
        stack: err.stack,
      };
      await this.options.adapter.saveExecution(instance.id, execution);

      this.logger.error("Rollback step failed", {
        data: {
          instanceId: instance.id,
          stepId: step.id,
        },
        error: err,
      });

      throw err;
    }
  }

  /**
   * Execute a function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Step execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        cleanup();
        reject(new Error('Step execution aborted'));
      };

      signal?.addEventListener('abort', onAbort);

      fn()
        .then(result => {
          cleanup();
          resolve(result);
        })
        .catch(error => {
          cleanup();
          reject(error);
        });
    });
  }

  /**
   * Validate workflow definition
   */
  private validateWorkflowDefinition(definition: IWorkflowDefinition): void {
    if (!definition.id) {
      throw new Error("Workflow ID is required");
    }
    
    if (!definition.initialState) {
      throw new Error("Initial state is required");
    }
    
    if (!definition.states || definition.states.length === 0) {
      throw new Error("At least one state is required");
    }
    
    if (!definition.states.includes(definition.initialState)) {
      throw new Error("Initial state must be included in states list");
    }
    
    // Validate transitions reference valid states
    for (const transition of definition.transitions) {
      if (!definition.states.includes(transition.from)) {
        throw new Error(`Transition 'from' state '${transition.from}' not found in states`);
      }
      if (!definition.states.includes(transition.to)) {
        throw new Error(`Transition 'to' state '${transition.to}' not found in states`);
      }
    }
    
    // Validate steps have unique IDs
    const stepIds = new Set();
    for (const step of definition.steps) {
      if (stepIds.has(step.id)) {
        throw new Error(`Duplicate step ID: ${step.id}`);
      }
      stepIds.add(step.id);
    }
  }

  /**
   * Setup timers for a workflow instance
   */
  private async setupTimers(instance: IWorkflowInstance): Promise<void> {
    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow?.timers) return;

    for (const timer of workflow.timers) {
      const timerId = `${instance.id}:${timer.id}`;
      
      const timeout = setTimeout(async () => {
        await this.handleTimerExpiry(instance.id, timer);
      }, timer.duration);

      this.activeTimers.set(timerId, timeout);
      instance.activeTimers.push(timer.id);
    }

    await this.options.adapter.updateInstance(instance);
  }

  /**
   * Clear timers for a workflow instance
   */
  private async clearTimers(instanceId: WorkflowInstanceId): Promise<void> {
    const instance = await this.getInstance(instanceId);
    if (!instance) return;

    for (const timerId of instance.activeTimers) {
      const fullTimerId = `${instanceId}:${timerId}`;
      const timeout = this.activeTimers.get(fullTimerId);
      if (timeout) {
        clearTimeout(timeout);
        this.activeTimers.delete(fullTimerId);
      }
    }

    instance.activeTimers = [];
    await this.options.adapter.updateInstance(instance);
  }

  /**
   * Handle timer expiry
   */
  private async handleTimerExpiry(instanceId: WorkflowInstanceId, timer: IWorkflowTimer): Promise<void> {
    const instance = await this.getInstance(instanceId);
    if (!instance) return;

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) return;

    try {
      // Execute timer task if provided
      if (timer.task) {
        await timer.task.run(instance.context, {});
      }

      // Transition to target state
      await this.transitionTo(instanceId, timer.targetState);

      // Emit timer triggered event
      if (workflow.events?.timerTriggered) {
        await this.eventManager.emit(workflow.events.timerTriggered, {
          instanceId,
          timerId: timer.id,
          context: instance.context,
        }, "workflow.engine");
      }

      this.logger.info("Timer triggered", {
        instanceId,
        timerId: timer.id,
        targetState: timer.targetState,
      });

      // Setup recurring timer
      if (timer.recurring) {
        const timerId = `${instanceId}:${timer.id}`;
        const timeout = setTimeout(async () => {
          await this.handleTimerExpiry(instanceId, timer);
        }, timer.duration);
        this.activeTimers.set(timerId, timeout);
      }
    } catch (error) {
      this.logger.error("Timer execution failed", {
        data: {
          instanceId,
          timerId: timer.id,
        },
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Check timers for a specific instance
   */
  private async checkInstanceTimers(instance: IWorkflowInstance, workflow: IWorkflowDefinition): Promise<void> {
    if (!workflow.timers) return;

    // This method can be extended to check for additional timer conditions
    // such as state-based timers, conditional timers, etc.
  }

  /**
   * Start the timer processor
   */
  private startTimerProcessor(): void {
    const processTimers = async () => {
      try {
        await this.processTimers();
      } catch (error) {
        this.logger.error("Timer processing error", {
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    };

    // Process timers immediately and then at intervals
    processTimers();
    setInterval(processTimers, this.options.timerCheckInterval);
  }

  /**
   * Generate unique instance ID
   */
  private generateInstanceId(): WorkflowInstanceId {
    return `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(): string {
    return `ex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}