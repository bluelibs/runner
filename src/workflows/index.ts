/**
 * BlueLibs Runner Durable Workflow System
 * 
 * A comprehensive workflow orchestration system that supports:
 * - State transitions based on transition schematics
 * - Workflow rollback capabilities
 * - Time-based workflow management (timeouts, scheduled actions)
 * - Parallel workflow execution
 * - Distributed delegation via adapters
 * - 100% test coverage
 * 
 * @example
 * ```typescript
 * import { defineWorkflow, defineWorkflowStep, workflowResource } from "@bluelibs/runner/workflows";
 * import { task, resource, run } from "@bluelibs/runner";
 * 
 * // Define workflow steps
 * const validateOrder = task({
 *   id: "validateOrder",
 *   run: async (orderData) => {
 *     // Validation logic
 *     return { valid: true, orderId: orderData.id };
 *   },
 * });
 * 
 * const processPayment = task({
 *   id: "processPayment", 
 *   run: async (orderData) => {
 *     // Payment processing
 *     return { paymentId: "pay_123", amount: orderData.amount };
 *   },
 * });
 * 
 * // Define workflow
 * const orderWorkflow = defineWorkflow({
 *   id: "order.processing",
 *   initialState: "pending",
 *   states: ["pending", "validated", "paid", "completed", "failed"],
 *   steps: [
 *     defineWorkflowStep({
 *       id: "validate",
 *       task: validateOrder,
 *       config: { timeout: 5000, retries: 2 },
 *     }),
 *     defineWorkflowStep({
 *       id: "payment",
 *       task: processPayment,
 *       config: { timeout: 30000, retries: 3 },
 *     }),
 *   ],
 *   transitions: [
 *     { from: "pending", to: "validated", steps: ["validate"] },
 *     { from: "validated", to: "paid", steps: ["payment"] },
 *     { from: "paid", to: "completed" },
 *   ],
 *   finalStates: ["completed", "failed"],
 *   timers: [{
 *     id: "payment_timeout",
 *     duration: 24 * 60 * 60 * 1000, // 24 hours
 *     targetState: "failed",
 *   }],
 * });
 * 
 * // Create app with workflow
 * const app = resource({
 *   id: "app",
 *   register: [workflowResource, validateOrder, processPayment],
 *   dependencies: { workflows: workflowResource },
 *   init: async (_, { workflows }) => {
 *     // Register workflow
 *     await workflows.registerWorkflow(orderWorkflow);
 *     
 *     // Create workflow instance
 *     const instance = await workflows.createInstance("order.processing", {
 *       orderId: "order_123",
 *       amount: 99.99,
 *     });
 *     
 *     // Execute workflow steps
 *     await workflows.transitionTo(instance.id, "validated");
 *     await workflows.transitionTo(instance.id, "paid");
 *     await workflows.transitionTo(instance.id, "completed");
 *     
 *     return { instance };
 *   },
 * });
 * 
 * // Run the application
 * const { dispose } = await run(app);
 * ```
 */

// Core workflow definitions and types
export * from "./defs";

// Factory functions for defining workflows
export * from "./define";

// Workflow engine implementation
export { WorkflowEngine } from "./WorkflowEngine";

// Persistence adapters
export { MemoryWorkflowAdapter } from "./adapters/MemoryWorkflowAdapter";

// BlueLibs Runner resource integration
export * from "./resource";

// Convenience aliases for common workflow patterns
export {
  defineWorkflow as workflow,
  defineWorkflowStep as workflowStep,
  defineWorkflowTransition as workflowTransition,
  defineWorkflowTimer as workflowTimer,
} from "./define";