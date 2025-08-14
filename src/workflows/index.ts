/**
 * BlueLibs Runner Durable Workflow System
 * 
 * A comprehensive workflow orchestration system that supports:
 * - State transitions based on transition schematics
 * - Workflow rollback capabilities
 * - Time-based workflow management (timeouts, scheduled actions)
 * - Parallel workflow execution
 * - Distributed delegation via adapters
 * - Object-oriented workflow definitions
 * 
 * @example Object-Oriented Pattern (Recommended)
 * ```typescript
 * import { Workflow, workflowResource } from "@bluelibs/runner/workflows";
 * import { task, resource, run, globals } from "@bluelibs/runner";
 * 
 * // Define business logic tasks
 * const validateOrder = task({
 *   id: "validateOrder",
 *   run: async (orderData) => {
 *     // Validation logic
 *     return { valid: true, orderId: orderData.id };
 *   },
 * });
 * 
 * // Create workflow class
 * class OrderWorkflow extends Workflow {
 *   constructor() {
 *     super({
 *       id: "order.processing",
 *       initialState: "pending",
 *       states: ["pending", "validated", "completed"],
 *       steps: [
 *         this.createStep({
 *           id: "validate",
 *           task: validateOrder,
 *           config: { timeout: 5000, retries: 2 },
 *         }),
 *       ],
 *       transitions: [
 *         { from: "pending", to: "validated", steps: ["validate"] },
 *         { from: "validated", to: "completed" },
 *       ],
 *     });
 *   }
 * }
 * 
 * // Use in application  
 * const app = resource({
 *   id: "app",
 *   register: [workflowResource, validateOrder], // or use globals.resources.workflow
 *   dependencies: { workflows: workflowResource },
 *   init: async (_, { workflows }) => {
 *     const orderWorkflow = new OrderWorkflow();
 *     await workflows.registerWorkflow(orderWorkflow);
 *     
 *     const instance = await workflows.createInstance(
 *       "order.processing", 
 *       { orderId: "123", amount: 99.99 }
 *     );
 *     
 *     await workflows.transitionTo(instance.id, "validated");
 *     await workflows.transitionTo(instance.id, "completed");
 *     
 *     return { instanceId: instance.id };
 *   }
 * });
 * 
 * const { value, dispose } = await run(app);
 * ```
 * 
 * @example Functional Pattern (Legacy)
 * ```typescript
 * import { defineWorkflow } from "@bluelibs/runner/workflows";
 * 
 * const orderWorkflow = defineWorkflow({
 *   id: "order.processing",
 *   initialState: "pending",
 *   states: ["pending", "validated", "completed"],
 *   // ... rest of configuration
 * });
 * ```
 */

// Core workflow class for OOP patterns
export { Workflow } from "./Workflow";

// Core workflow definitions and types
export * from "./defs";

// Factory functions for functional patterns (legacy)
export * from "./define";

// Workflow engine implementation
export { WorkflowEngine } from "./WorkflowEngine";

// Persistence adapters
export { MemoryWorkflowAdapter } from "./adapters/MemoryWorkflowAdapter";

// Resource integration - re-export from globals for convenience
export { workflowResource, memoryWorkflowResource } from "../globals/resources/workflow.resource";

// Legacy exports for backward compatibility
export {
  defineWorkflow as workflow,
  defineWorkflowStep as workflowStep,
  defineWorkflowTransition as workflowTransition,
  defineWorkflowTimer as workflowTimer,
} from "./define";