/**
 * Workflow management resource for BlueLibs Runner.
 * 
 * This resource provides workflow management capabilities as a BlueLibs Runner
 * resource, integrating seamlessly with the existing framework.
 * 
 * Following the OOP pattern established by Queue and Semaphore resources,
 * this provides a clean, class-based interface for workflow management.
 */

import { defineResource } from "../../define";
import { WorkflowEngine } from "../../workflows/WorkflowEngine";
import { MemoryWorkflowAdapter } from "../../workflows/adapters/MemoryWorkflowAdapter";
import { Workflow } from "../../workflows/Workflow";
import {
  IWorkflowDefinition,
  IWorkflowInstance,
  IWorkflowExecution,
  IWorkflowAdapter,
  IWorkflowEngineOptions,
  IStepExecutionResult,
  WorkflowInstanceId,
  WorkflowState,
  WorkflowContext,
} from "../../workflows/defs";

/**
 * Configuration for the workflow resource
 */
export interface IWorkflowResourceConfig {
  /** Persistence adapter to use (defaults to MemoryWorkflowAdapter) */
  adapter?: IWorkflowAdapter;
  /** Default timeout for step execution (milliseconds) */
  defaultStepTimeout?: number;
  /** Default number of retries for failed steps */
  defaultRetries?: number;
  /** Whether to enable parallel execution */
  enableParallelExecution?: boolean;
  /** Interval for checking expired timers (milliseconds) */
  timerCheckInterval?: number;
  /** EventManager instance (optional, will create new if not provided) */
  eventManager?: any;
  /** Logger instance (optional, will create new if not provided) */
  logger?: any;
}

/**
 * Workflow management resource
 * 
 * Provides a complete workflow engine as a BlueLibs Runner resource with
 * automatic lifecycle management and dependency injection.
 */
export const workflowResource = defineResource<IWorkflowResourceConfig>({
  id: "globals.resources.workflow",
  init: async (
    config = {} as IWorkflowResourceConfig,
    dependencies: any
  ) => {
    // Create EventManager and Logger if not provided in config
    const eventManager = config.eventManager || new (await import("../../models/EventManager")).EventManager();
    const logger = config.logger || new (await import("../../models/Logger")).Logger(eventManager);
    const adapter = config.adapter || new MemoryWorkflowAdapter();
    
    const engineOptions: IWorkflowEngineOptions = {
      adapter,
      defaultStepTimeout: config.defaultStepTimeout || 30000,
      defaultRetries: config.defaultRetries || 3,
      enableParallelExecution: config.enableParallelExecution ?? true,
      timerCheckInterval: config.timerCheckInterval || 1000,
    };

    const engine = new WorkflowEngine(engineOptions, eventManager, logger);

    return {
      /** The underlying workflow engine */
      engine,

      /** Register a workflow definition or Workflow class instance */
      registerWorkflow: (workflow: IWorkflowDefinition | Workflow) => {
        const definition = workflow instanceof Workflow ? workflow.toDefinition() : workflow;
        return engine.registerWorkflow(definition);
      },

      /** Create a new workflow instance */
      createInstance: <TContext extends WorkflowContext = WorkflowContext>(
        workflowId: string,
        context: TContext,
        instanceId?: WorkflowInstanceId
      ) => engine.createInstance(workflowId, context, instanceId),

      /** Execute a workflow step */
      executeStep: (
        instanceId: WorkflowInstanceId,
        stepId: string,
        input?: any
      ) => engine.executeStep(instanceId, stepId, input),

      /** Transition workflow to a new state */
      transitionTo: (
        instanceId: WorkflowInstanceId,
        targetState: WorkflowState,
        stepOutputs?: Record<string, any>
      ) => engine.transitionTo(instanceId, targetState, stepOutputs),

      /** Start rollback process for a workflow */
      rollback: (
        instanceId: WorkflowInstanceId,
        targetState?: WorkflowState
      ) => engine.rollback(instanceId, targetState),

      /** Cancel a workflow instance */
      cancel: (instanceId: WorkflowInstanceId, reason?: string) =>
        engine.cancel(instanceId, reason),

      /** Get workflow instance by ID */
      getInstance: (instanceId: WorkflowInstanceId) =>
        engine.getInstance(instanceId),

      /** Get execution history for an instance */
      getExecutionHistory: (instanceId: WorkflowInstanceId) =>
        engine.getExecutionHistory(instanceId),

      /** Check and process expired timers */
      processTimers: () => engine.processTimers(),

      /** Cleanup expired or completed instances */
      cleanup: (olderThan?: Date) => engine.cleanup(olderThan),

      /** Access to the underlying adapter (useful for testing) */
      getAdapter: () => adapter,
    };
  },
  dispose: async (value) => {
    await value.engine.dispose();
  },
  meta: {
    title: "Workflow Engine",
    description: "Durable workflow management with state transitions, rollbacks, and time-based triggers. Supports both OOP patterns with Workflow classes and functional patterns with workflow definitions.",
  },
});

/**
 * Memory-based workflow resource for testing and development
 */
export const memoryWorkflowResource = workflowResource.with({
  adapter: new MemoryWorkflowAdapter(),
  defaultStepTimeout: 5000,
  defaultRetries: 1,
  timerCheckInterval: 100,
});

/**
 * Type-safe workflow resource interface
 */
export type WorkflowResourceType = Awaited<ReturnType<NonNullable<typeof workflowResource.init>>>;