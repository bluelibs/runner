/**
 * Core types and interfaces for the BlueLibs Runner durable workflow system.
 * 
 * This module provides a comprehensive workflow orchestration system that supports:
 * - State transitions based on transition schematics
 * - Workflow rollback capabilities
 * - Time-based workflow management (timeouts, scheduled actions)
 * - Parallel workflow execution
 * - Distributed delegation via adapters
 */

import { IValidationSchema, DependencyMapType, ITask, IEvent } from "../defs";

/**
 * Represents the current state of a workflow instance
 */
export type WorkflowState = string;

/**
 * Unique identifier for a workflow instance
 */
export type WorkflowInstanceId = string;

/**
 * Context data that flows through workflow execution
 */
export type WorkflowContext = Record<string, any>;

/**
 * Workflow execution status
 */
export enum WorkflowStatus {
  PENDING = "pending",
  RUNNING = "running", 
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
  ROLLBACK = "rollback"
}

/**
 * Configuration for workflow step execution
 */
export interface IWorkflowStepConfig {
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
}

/**
 * Definition of a single workflow step
 */
export interface IWorkflowStep<TInput = any, TOutput = any> {
  /** Unique identifier for this step */
  id: string;
  /** Human-readable name for this step */
  name?: string;
  /** Description of what this step does */
  description?: string;
  /** Configuration for step execution */
  config?: IWorkflowStepConfig;
  /** Task to execute for this step */
  task: ITask<TInput, Promise<TOutput>, any>;
  /** Optional rollback task */
  rollbackTask?: ITask<TOutput, Promise<void>, any>;
  /** Validation schema for step input */
  inputSchema?: IValidationSchema<TInput>;
  /** Validation schema for step output */
  outputSchema?: IValidationSchema<TOutput>;
}

/**
 * Defines valid state transitions in a workflow
 */
export interface IWorkflowTransition {
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

/**
 * Time-based trigger for workflow actions
 */
export interface IWorkflowTimer {
  /** Unique identifier for this timer */
  id: string;
  /** Duration in milliseconds */
  duration: number;
  /** Target state to transition to when timer expires */
  targetState: WorkflowState;
  /** Optional task to execute when timer triggers */
  task?: ITask<WorkflowContext, Promise<any>, any>;
  /** Whether timer should repeat */
  recurring?: boolean;
}

/**
 * Definition of a complete workflow
 */
export interface IWorkflowDefinition<TContext extends WorkflowContext = WorkflowContext> {
  /** Unique identifier for this workflow type */
  id: string;
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
    stateChanged?: IEvent<{ instanceId: WorkflowInstanceId; from: WorkflowState; to: WorkflowState; context: TContext }>;
    stepCompleted?: IEvent<{ instanceId: WorkflowInstanceId; stepId: string; output: any; context: TContext }>;
    stepFailed?: IEvent<{ instanceId: WorkflowInstanceId; stepId: string; error: Error; context: TContext }>;
    rollbackStarted?: IEvent<{ instanceId: WorkflowInstanceId; fromState: WorkflowState; context: TContext }>;
    rollbackCompleted?: IEvent<{ instanceId: WorkflowInstanceId; toState: WorkflowState; context: TContext }>;
    timerTriggered?: IEvent<{ instanceId: WorkflowInstanceId; timerId: string; context: TContext }>;
  };
}

/**
 * Runtime instance of a workflow
 */
export interface IWorkflowInstance<TContext extends WorkflowContext = WorkflowContext> {
  /** Unique identifier for this instance */
  id: WorkflowInstanceId;
  /** ID of the workflow definition this instance is based on */
  workflowId: string;
  /** Current state */
  currentState: WorkflowState;
  /** Current status */
  status: WorkflowStatus;
  /** Workflow context data */
  context: TContext;
  /** History of executed steps */
  executionHistory: IWorkflowExecution[];
  /** Active timers */
  activeTimers: string[];
  /** Timestamp when instance was created */
  createdAt: Date;
  /** Timestamp when instance was last updated */
  updatedAt: Date;
  /** Optional timestamp when instance completed */
  completedAt?: Date;
  /** Error information if workflow failed */
  error?: {
    message: string;
    stack?: string;
    stepId?: string;
  };
}

/**
 * Record of a step execution
 */
export interface IWorkflowExecution {
  /** Unique identifier for this execution */
  id: string;
  /** ID of the step that was executed */
  stepId: string;
  /** State before execution */
  fromState: WorkflowState;
  /** State after execution */
  toState: WorkflowState;
  /** Input provided to the step */
  input: any;
  /** Output produced by the step */
  output?: any;
  /** Execution status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back';
  /** When execution started */
  startedAt: Date;
  /** When execution completed */
  completedAt?: Date;
  /** Error if execution failed */
  error?: {
    message: string;
    stack?: string;
  };
  /** Whether this execution was a rollback */
  isRollback?: boolean;
  /** Retry attempt number */
  retryAttempt?: number;
}

/**
 * Persistence adapter interface for workflow storage
 */
export interface IWorkflowAdapter {
  /** Save a workflow instance */
  saveInstance(instance: IWorkflowInstance): Promise<void>;
  
  /** Load a workflow instance by ID */
  loadInstance(instanceId: WorkflowInstanceId): Promise<IWorkflowInstance | null>;
  
  /** Update an existing workflow instance */
  updateInstance(instance: IWorkflowInstance): Promise<void>;
  
  /** Delete a workflow instance */
  deleteInstance(instanceId: WorkflowInstanceId): Promise<void>;
  
  /** Find workflow instances by criteria */
  findInstances(criteria: {
    workflowId?: string;
    status?: WorkflowStatus;
    state?: WorkflowState;
    createdBefore?: Date;
    createdAfter?: Date;
  }): Promise<IWorkflowInstance[]>;
  
  /** Save workflow execution record */
  saveExecution(instanceId: WorkflowInstanceId, execution: IWorkflowExecution): Promise<void>;
  
  /** Load execution history for an instance */
  loadExecutions(instanceId: WorkflowInstanceId): Promise<IWorkflowExecution[]>;
  
  /** Clean up expired or completed instances */
  cleanup?(olderThan: Date): Promise<number>;
}

/**
 * Workflow engine options
 */
export interface IWorkflowEngineOptions {
  /** Persistence adapter to use */
  adapter: IWorkflowAdapter;
  /** Default timeout for step execution (milliseconds) */
  defaultStepTimeout?: number;
  /** Default number of retries for failed steps */
  defaultRetries?: number;
  /** Whether to enable parallel execution */
  enableParallelExecution?: boolean;
  /** Interval for checking expired timers (milliseconds) */
  timerCheckInterval?: number;
}

/**
 * Result of workflow step execution
 */
export interface IStepExecutionResult {
  /** Whether execution was successful */
  success: boolean;
  /** Output from the step */
  output?: any;
  /** Error if execution failed */
  error?: Error;
  /** New state after step execution */
  newState?: WorkflowState;
  /** Whether workflow should continue */
  shouldContinue: boolean;
}

/**
 * Workflow engine interface
 */
export interface IWorkflowEngine {
  /** Register a workflow definition */
  registerWorkflow(definition: IWorkflowDefinition): Promise<void>;
  
  /** Create a new workflow instance */
  createInstance<TContext extends WorkflowContext = WorkflowContext>(
    workflowId: string,
    context: TContext,
    instanceId?: WorkflowInstanceId
  ): Promise<IWorkflowInstance<TContext>>;
  
  /** Execute a workflow step */
  executeStep(
    instanceId: WorkflowInstanceId,
    stepId: string,
    input?: any
  ): Promise<IStepExecutionResult>;
  
  /** Transition workflow to a new state */
  transitionTo(
    instanceId: WorkflowInstanceId,
    targetState: WorkflowState,
    stepOutputs?: Record<string, any>
  ): Promise<boolean>;
  
  /** Start rollback process for a workflow */
  rollback(
    instanceId: WorkflowInstanceId,
    targetState?: WorkflowState
  ): Promise<boolean>;
  
  /** Cancel a workflow instance */
  cancel(instanceId: WorkflowInstanceId, reason?: string): Promise<void>;
  
  /** Get workflow instance by ID */
  getInstance(instanceId: WorkflowInstanceId): Promise<IWorkflowInstance | null>;
  
  /** Get execution history for an instance */
  getExecutionHistory(instanceId: WorkflowInstanceId): Promise<IWorkflowExecution[]>;
  
  /** Check and process expired timers */
  processTimers(): Promise<void>;
  
  /** Cleanup expired or completed instances */
  cleanup(olderThan?: Date): Promise<number>;
}