/**
 * Base Workflow class for creating durable workflows in an OOP pattern.
 * 
 * This class provides the foundation for creating workflow definitions using 
 * object-oriented patterns, similar to how Queue and Semaphore work in BlueLibs Runner.
 * 
 * Users can extend this class to create custom workflows with type safety and
 * a clean, declarative API.
 * 
 * @example
 * ```typescript
 * class OrderWorkflow extends Workflow {
 *   constructor() {
 *     super({
 *       id: "order.processing",
 *       initialState: "pending",
 *       states: ["pending", "validated", "paid", "completed", "failed"],
 *       transitions: [
 *         { from: "pending", to: "validated", steps: ["validate"] },
 *         { from: "validated", to: "paid", steps: ["payment"] }
 *       ],
 *       steps: [
 *         { id: "validate", task: validateOrderTask },
 *         { id: "payment", task: processPaymentTask }
 *       ]
 *     });
 *   }
 * }
 * ```
 */

import { IValidationSchema, DependencyMapType, IEvent, ITask } from "../defs";
import {
  IWorkflowDefinition,
  IWorkflowStep,
  IWorkflowTransition,
  IWorkflowTimer,
  WorkflowState,
  WorkflowContext,
} from "./defs";
import { generateCallerIdFromFile, getCallerFile } from "../tools/getCallerFile";

/**
 * Configuration for Workflow constructor
 */
export interface WorkflowConfig<TContext extends WorkflowContext = WorkflowContext> {
  /** Unique identifier for this workflow type */
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

/**
 * Base Workflow class for OOP workflow definitions
 */
export abstract class Workflow<TContext extends WorkflowContext = WorkflowContext> 
  implements IWorkflowDefinition<TContext> {
  
  public readonly id: string;
  public readonly name?: string;
  public readonly description?: string;
  public readonly initialState: WorkflowState;
  public readonly states: WorkflowState[];
  public readonly transitions: IWorkflowTransition[];
  public readonly steps: IWorkflowStep[];
  public readonly timers?: IWorkflowTimer[];
  public readonly contextSchema?: IValidationSchema<TContext>;
  public readonly finalStates?: WorkflowState[];
  public readonly dependencies?: DependencyMapType;
  public readonly events?: {
    stateChanged?: IEvent<{ instanceId: string; from: WorkflowState; to: WorkflowState; context: TContext }>;
    stepCompleted?: IEvent<{ instanceId: string; stepId: string; output: any; context: TContext }>;
    stepFailed?: IEvent<{ instanceId: string; stepId: string; error: Error; context: TContext }>;
    rollbackStarted?: IEvent<{ instanceId: string; fromState: WorkflowState; context: TContext }>;
    rollbackCompleted?: IEvent<{ instanceId: string; toState: WorkflowState; context: TContext }>;
    timerTriggered?: IEvent<{ instanceId: string; timerId: string; context: TContext }>;
  };

  constructor(config: WorkflowConfig<TContext>) {
    this.id = config.id || String(generateCallerIdFromFile(getCallerFile()));
    this.name = config.name;
    this.description = config.description;
    this.initialState = config.initialState;
    this.states = config.states;
    this.transitions = config.transitions;
    this.steps = config.steps;
    this.timers = config.timers;
    this.contextSchema = config.contextSchema;
    this.finalStates = config.finalStates;
    this.dependencies = config.dependencies;
    this.events = config.events;

    // Validate the workflow definition
    this.validate();
  }

  /**
   * Create a workflow step definition
   */
  protected createStep<TInput = any, TOutput = any>(definition: {
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
    task: ITask<TInput, Promise<TOutput>, any>;
    /** Optional rollback task */
    rollbackTask?: ITask<TOutput, Promise<void>, any>;
    /** Validation schema for step input */
    inputSchema?: IValidationSchema<TInput>;
    /** Validation schema for step output */
    outputSchema?: IValidationSchema<TOutput>;
  }): IWorkflowStep<TInput, TOutput> {
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
   * Create a workflow transition definition
   */
  protected createTransition(definition: {
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
  }): IWorkflowTransition {
    return {
      from: definition.from,
      to: definition.to,
      condition: definition.condition,
      steps: definition.steps,
      rollbackable: definition.rollbackable,
    };
  }

  /**
   * Create a workflow timer definition
   */
  protected createTimer(definition: {
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
  }): IWorkflowTimer {
    return {
      id: definition.id,
      duration: definition.duration,
      targetState: definition.targetState,
      task: definition.task,
      recurring: definition.recurring,
    };
  }

  /**
   * Validate the workflow definition
   */
  private validate(): void {
    if (!this.id || typeof this.id !== 'string') {
      throw new Error("Workflow must have a valid ID");
    }

    if (!this.initialState || typeof this.initialState !== 'string') {
      throw new Error("Workflow must have a valid initial state");
    }

    if (!Array.isArray(this.states) || this.states.length === 0) {
      throw new Error("Workflow must have at least one state");
    }

    if (!this.states.includes(this.initialState)) {
      throw new Error("Initial state must be included in the states array");
    }

    // Validate transitions reference valid states
    for (const transition of this.transitions) {
      if (!this.states.includes(transition.from)) {
        throw new Error(`Transition references invalid from state: ${transition.from}`);
      }
      if (!this.states.includes(transition.to)) {
        throw new Error(`Transition references invalid to state: ${transition.to}`);
      }
    }

    // Validate steps have unique IDs
    const stepIds = new Set();
    for (const step of this.steps) {
      if (stepIds.has(step.id)) {
        throw new Error(`Duplicate step ID: ${step.id}`);
      }
      stepIds.add(step.id);
    }

    // Validate transition steps reference valid step IDs
    for (const transition of this.transitions) {
      if (transition.steps) {
        for (const stepId of transition.steps) {
          if (!stepIds.has(stepId)) {
            throw new Error(`Transition references invalid step ID: ${stepId}`);
          }
        }
      }
    }

    // Validate final states are included in states array
    if (this.finalStates) {
      for (const finalState of this.finalStates) {
        if (!this.states.includes(finalState)) {
          throw new Error(`Final state not in states array: ${finalState}`);
        }
      }
    }

    // Validate timers reference valid states
    if (this.timers) {
      for (const timer of this.timers) {
        if (!this.states.includes(timer.targetState)) {
          throw new Error(`Timer references invalid target state: ${timer.targetState}`);
        }
      }
    }
  }

  /**
   * Get the workflow definition (compatibility with engine)
   */
  toDefinition(): IWorkflowDefinition<TContext> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      initialState: this.initialState,
      states: this.states,
      transitions: this.transitions,
      steps: this.steps,
      timers: this.timers,
      contextSchema: this.contextSchema,
      finalStates: this.finalStates,
      dependencies: this.dependencies,
      events: this.events,
    };
  }
}