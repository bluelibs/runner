/**
 * Factory functions for defining workflows.
 * 
 * These helpers create strongly-typed workflow definitions following the same
 * patterns as tasks, resources, events and middleware in BlueLibs Runner.
 */

import {
  IWorkflowDefinition,
  IWorkflowStep,
  IWorkflowTransition,
  IWorkflowTimer,
  WorkflowState,
  WorkflowContext,
} from "./defs";
import { IValidationSchema, DependencyMapType, IEvent } from "../defs";
import { generateCallerIdFromFile, getCallerFile } from "../tools/getCallerFile";

/**
 * Define a workflow.
 * 
 * Creates a strongly-typed workflow definition with states, transitions, steps,
 * and optional timers for time-based workflow management.
 * 
 * @param definition Workflow definition
 * @returns Workflow definition object
 */
export function defineWorkflow<TContext extends WorkflowContext = WorkflowContext>(
  definition: {
    /** Unique identifier for this workflow type. If omitted, generates anonymous ID from file path */
    id?: string;
    /** Human-readable name */
    name?: string;
    /** Description of the workflow */
    description?: string;
    /** Initial state when workflow is created */
    initialState: WorkflowState;
    /** All possible states in this workflow */
    states: WorkflowState[];
    /** Valid transitions between states */
    transitions: IWorkflowTransition[];
    /** All steps that can be executed in this workflow */
    steps: IWorkflowStep[];
    /** Time-based triggers */
    timers?: IWorkflowTimer[];
    /** Validation schema for workflow context */
    contextSchema?: IValidationSchema<TContext>;
    /** Final states that mark workflow completion */
    finalStates?: WorkflowState[];
    /** Dependencies required by the workflow */
    dependencies?: DependencyMapType;
    /** Events emitted by the workflow */
    events?: {
      stateChanged?: IEvent<{ instanceId: string; from: WorkflowState; to: WorkflowState; context: TContext }>;
      stepCompleted?: IEvent<{ instanceId: string; stepId: string; output: any; context: TContext }>;
      stepFailed?: IEvent<{ instanceId: string; stepId: string; error: Error; context: TContext }>;
      rollbackStarted?: IEvent<{ instanceId: string; fromState: WorkflowState; context: TContext }>;
      rollbackCompleted?: IEvent<{ instanceId: string; toState: WorkflowState; context: TContext }>;
      timerTriggered?: IEvent<{ instanceId: string; timerId: string; context: TContext }>;
    };
  }
): IWorkflowDefinition<TContext> {
  const id = definition.id || generateCallerIdFromFile(getCallerFile());

  return {
    id: String(id),
    name: definition.name,
    description: definition.description,
    initialState: definition.initialState,
    states: definition.states,
    transitions: definition.transitions,
    steps: definition.steps,
    timers: definition.timers,
    contextSchema: definition.contextSchema,
    finalStates: definition.finalStates,
    dependencies: definition.dependencies,
    events: definition.events,
  };
}

/**
 * Define a workflow step.
 * 
 * Creates a workflow step with execution configuration, validation schemas,
 * and optional rollback capabilities.
 * 
 * @param definition Step definition
 * @returns Workflow step definition
 */
export function defineWorkflowStep<TInput = any, TOutput = any>(
  definition: {
    /** Unique identifier for this step */
    id: string;
    /** Human-readable name for this step */
    name?: string;
    /** Description of what this step does */
    description?: string;
    /** Configuration for step execution */
    config?: {
      /** Maximum time allowed for step execution (in milliseconds) */
      timeout?: number;
      /** Number of retry attempts for failed steps */
      retries?: number;
      /** Whether this step can be executed in parallel with others */
      parallel?: boolean;
      /** Whether this step supports rollback */
      rollbackable?: boolean;
      /** Dependencies required before this step can execute */
      dependencies?: string[];
    };
    /** Task to execute for this step */
    task: import("../defs").ITask<TInput, Promise<TOutput>, any>;
    /** Optional rollback task */
    rollbackTask?: import("../defs").ITask<TOutput, Promise<void>, any>;
    /** Validation schema for step input */
    inputSchema?: IValidationSchema<TInput>;
    /** Validation schema for step output */
    outputSchema?: IValidationSchema<TOutput>;
  }
): IWorkflowStep<TInput, TOutput> {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    config: definition.config,
    task: definition.task,
    rollbackTask: definition.rollbackTask,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
  };
}

/**
 * Define a workflow transition.
 * 
 * Creates a state transition definition with optional conditions and steps.
 * 
 * @param definition Transition definition
 * @returns Workflow transition definition
 */
export function defineWorkflowTransition(
  definition: {
    /** Source state */
    from: WorkflowState;
    /** Target state */
    to: WorkflowState;
    /** Optional condition that must be met for transition */
    condition?: (context: WorkflowContext, stepOutput?: any) => boolean | Promise<boolean>;
    /** Steps to execute during this transition */
    steps?: string[];
    /** Whether this transition can be rolled back */
    rollbackable?: boolean;
  }
): IWorkflowTransition {
  return {
    from: definition.from,
    to: definition.to,
    condition: definition.condition,
    steps: definition.steps,
    rollbackable: definition.rollbackable,
  };
}

/**
 * Define a workflow timer.
 * 
 * Creates a time-based trigger for workflow state transitions or actions.
 * 
 * @param definition Timer definition
 * @returns Workflow timer definition
 */
export function defineWorkflowTimer(
  definition: {
    /** Unique identifier for this timer */
    id: string;
    /** Duration in milliseconds */
    duration: number;
    /** Target state to transition to when timer expires */
    targetState: WorkflowState;
    /** Optional task to execute when timer triggers */
    task?: import("../defs").ITask<WorkflowContext, Promise<any>, any>;
    /** Whether timer should repeat */
    recurring?: boolean;
  }
): IWorkflowTimer {
  return {
    id: definition.id,
    duration: definition.duration,
    targetState: definition.targetState,
    task: definition.task,
    recurring: definition.recurring,
  };
}

// Convenience re-exports for workflow status and other enums
export { WorkflowStatus } from "./defs";

// Type exports for convenience
export type {
  IWorkflowDefinition,
  IWorkflowStep,
  IWorkflowTransition,
  IWorkflowTimer,
  IWorkflowInstance,
  IWorkflowExecution,
  IWorkflowAdapter,
  IWorkflowEngine,
  IWorkflowEngineOptions,
  IStepExecutionResult,
  WorkflowInstanceId,
  WorkflowState,
  WorkflowContext,
} from "./defs";