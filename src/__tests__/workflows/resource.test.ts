/**
 * Test suite for the workflow resource integration
 */

import { run } from "../../run";
import { defineResource as resource, defineTask as task } from "../../define";
import { workflowResource, memoryWorkflowResource } from "../../globals/resources/workflow.resource";
import { defineWorkflow, defineWorkflowStep } from "../../workflows/define";
import { Workflow } from "../../workflows/Workflow";
import { WorkflowStatus } from "../../workflows/defs";
import { MemoryWorkflowAdapter } from "../../workflows/adapters/MemoryWorkflowAdapter";

describe("Workflow Resource Integration", () => {
  describe("workflowResource", () => {
    it("should initialize workflow resource with default configuration", async () => {
      const app = resource({
        id: "test.app",
        register: [workflowResource],
        dependencies: { workflows: workflowResource },
        init: async (_: any, { workflows }: any) => {
          expect(workflows).toBeDefined();
          expect(workflows.engine).toBeDefined();
          expect(typeof workflows.registerWorkflow).toBe("function");
          expect(typeof workflows.createInstance).toBe("function");
          expect(typeof workflows.executeStep).toBe("function");
          return {};
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    it("should initialize with custom configuration", async () => {
      const customAdapter = new MemoryWorkflowAdapter();
      
      const app = resource({
        id: "test.app",
        register: [
          workflowResource.with({
            adapter: customAdapter,
            defaultStepTimeout: 10000,
            defaultRetries: 5,
            enableParallelExecution: false,
            timerCheckInterval: 500,
          }),
        ],
        dependencies: { workflows: workflowResource },
        init: async (_: any, { workflows }: any) => {
          expect(workflows.getAdapter()).toBe(customAdapter);
          return {};
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    it("should work with memory workflow resource", async () => {
      const app = resource({
        id: "test.app",
        register: [memoryWorkflowResource],
        dependencies: { workflows: memoryWorkflowResource },
        init: async (_: any, { workflows }: any) => {
          expect(workflows).toBeDefined();
          expect(workflows.getAdapter()).toBeInstanceOf(MemoryWorkflowAdapter);
          return {};
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("complete workflow execution", () => {
    it("should execute a complete workflow end-to-end", async () => {
      // Define tasks
      const validateOrderTask = task({
        id: "validate.order",
        run: async (orderData: { orderId: string; amount: number }) => {
          if (!orderData.orderId || orderData.amount <= 0) {
            throw new Error("Invalid order data");
          }
          return { valid: true, orderId: orderData.orderId };
        },
      });

      const processPaymentTask = task({
        id: "process.payment",
        run: async (orderData: { amount: number }) => {
          if (orderData.amount > 1000) {
            throw new Error("Amount too large");
          }
          return { paymentId: "pay_123", amount: orderData.amount };
        },
      });

      const rollbackPaymentTask = task({
        id: "rollback.payment",
        run: async (paymentData: { paymentId: string }) => {
          // Simulate rollback
          return undefined;
        },
      });

      // Define workflow steps
      const validateStep = defineWorkflowStep({
        id: "validate",
        name: "Validate Order",
        task: validateOrderTask,
        config: { timeout: 5000, retries: 2 },
      });

      const paymentStep = defineWorkflowStep({
        id: "payment",
        name: "Process Payment",
        task: processPaymentTask,
        rollbackTask: rollbackPaymentTask,
        config: { timeout: 10000, rollbackable: true },
      });

      // Define workflow
      const orderWorkflow = defineWorkflow({
        id: "order.processing",
        name: "Order Processing Workflow",
        initialState: "pending",
        states: ["pending", "validated", "paid", "completed", "failed"],
        steps: [validateStep, paymentStep],
        transitions: [
          { from: "pending", to: "validated", steps: ["validate"] },
          { from: "validated", to: "paid", steps: ["payment"] },
          { from: "paid", to: "completed" },
        ],
        finalStates: ["completed", "failed"],
      });

      // Create application
      const app = resource({
        id: "order.app",
        register: [
          memoryWorkflowResource,
          validateOrderTask,
          processPaymentTask,
          rollbackPaymentTask,
        ],
        dependencies: { workflows: memoryWorkflowResource.resource },
        init: async (_: any, { workflows }: any) => {
          // Register workflow
          await workflows.registerWorkflow(orderWorkflow);

          // Create workflow instance
          const instance = await workflows.createInstance("order.processing", {
            orderId: "order_123",
            amount: 99.99,
            customerEmail: "test@example.com",
          });

          expect(instance.id).toBeDefined();
          expect(instance.workflowId).toBe("order.processing");
          expect(instance.currentState).toBe("pending");
          expect(instance.status).toBe(WorkflowStatus.PENDING);

          // Execute workflow transitions
          let success = await workflows.transitionTo(instance.id, "validated");
          expect(success).toBe(true);

          success = await workflows.transitionTo(instance.id, "paid");
          expect(success).toBe(true);

          success = await workflows.transitionTo(instance.id, "completed");
          expect(success).toBe(true);

          // Verify final state
          const finalInstance = await workflows.getInstance(instance.id);
          expect(finalInstance?.currentState).toBe("completed");
          expect(finalInstance?.status).toBe(WorkflowStatus.COMPLETED);
          expect(finalInstance?.completedAt).toBeInstanceOf(Date);

          // Verify execution history
          const history = await workflows.getExecutionHistory(instance.id);
          expect(history).toHaveLength(2); // validate and payment steps
          expect(history.every((h: any) => h.status === "completed")).toBe(true);

          return { instanceId: instance.id };
        },
      });

      const { value, dispose } = await run(app);
      expect((value as any).instanceId).toBeDefined();
      await dispose();
    });

    it("should handle workflow failures and rollbacks", async () => {
      const failingTask = task({
        id: "failing.task",
        run: async () => {
          throw new Error("Task always fails");
        },
      });

      const rollbackTask = task({
        id: "rollback.task",
        run: async () => {
          console.log("rolled back");
        },
      });

      const failingStep = defineWorkflowStep({
        id: "failing.step",
        task: failingTask,
        rollbackTask,
        config: { rollbackable: true },
      });

      const workflow = defineWorkflow({
        id: "failing.workflow",
        initialState: "start",
        states: ["start", "failed"],
        steps: [failingStep],
        transitions: [
          { from: "start", to: "failed", steps: ["failing.step"] },
        ],
      });

      const app = resource({
        id: "failing.app",
        register: [memoryWorkflowResource, failingTask, rollbackTask],
        dependencies: { workflows: memoryWorkflowResource.resource },
        init: async (_: any, { workflows }: any) => {
          await workflows.registerWorkflow(workflow);
          
          const instance = await workflows.createInstance("failing.workflow", {});

          // Attempt transition should fail
          const success = await workflows.transitionTo(instance.id, "failed");
          expect(success).toBe(false);

          // Instance should still be in start state
          const currentInstance = await workflows.getInstance(instance.id);
          expect(currentInstance?.currentState).toBe("start");

          // Execute rollback
          const rollbackSuccess = await workflows.rollback(instance.id);
          expect(rollbackSuccess).toBe(true);

          return { instanceId: instance.id };
        },
      });

      const { value, dispose } = await run(app);
      expect((value as any).instanceId).toBeDefined();
      await dispose();
    });

    it("should handle concurrent workflow executions", async () => {
      const concurrentTask = task({
        id: "concurrent.task",
        run: async (input: { delay: number }) => {
          await new Promise(resolve => setTimeout(resolve, input.delay));
          return { completed: true, delay: input.delay };
        },
      });

      const step = defineWorkflowStep({
        id: "concurrent.step",
        task: concurrentTask,
      });

      const workflow = defineWorkflow({
        id: "concurrent.workflow",
        initialState: "pending",
        states: ["pending", "completed"],
        steps: [step],
        transitions: [
          { from: "pending", to: "completed", steps: ["concurrent.step"] },
        ],
        finalStates: ["completed"],
      });

      const app = resource({
        id: "concurrent.app",
        register: [memoryWorkflowResource, concurrentTask],
        dependencies: { workflows: memoryWorkflowResource.resource },
        init: async (_: any, { workflows }: any) => {
          await workflows.registerWorkflow(workflow);

          // Create multiple instances
          const instances = await Promise.all([
            workflows.createInstance("concurrent.workflow", { delay: 10 }),
            workflows.createInstance("concurrent.workflow", { delay: 20 }),
            workflows.createInstance("concurrent.workflow", { delay: 15 }),
          ]);

          // Execute all transitions concurrently
          const results = await Promise.all(
            instances.map((instance: any) => 
              workflows.transitionTo(instance.id, "completed")
            )
          );

          expect(results.every((r: any) => r === true)).toBe(true);

          // Verify all instances completed
          const finalInstances = await Promise.all(
            instances.map((instance: any) => workflows.getInstance(instance.id))
          );

          expect(finalInstances.every((i: any) => 
            i?.status === WorkflowStatus.COMPLETED && 
            i?.currentState === "completed"
          )).toBe(true);

          return { instanceCount: instances.length };
        },
      });

      const { value, dispose } = await run(app);
      expect((value as any).instanceCount).toBe(3);
      await dispose();
    });

    it("should handle workflow with timers", (done) => {
      const timerTask = task({
        id: "timer.notification",
        run: async (context: any) => {
          return { notified: true, context };
        },
      });

      const workflow = defineWorkflow({
        id: "timer.workflow",
        initialState: "waiting",
        states: ["waiting", "notified", "completed"],
        steps: [],
        transitions: [
          { from: "waiting", to: "notified" },
          { from: "notified", to: "completed" },
        ],
        timers: [{
          id: "notification.timer",
          duration: 50, // 50ms for quick testing
          targetState: "notified",
          task: timerTask,
        }],
        finalStates: ["completed"],
      });

      const app = resource({
        id: "timer.app",
        register: [memoryWorkflowResource, timerTask],
        dependencies: { workflows: memoryWorkflowResource },
        init: async (_: any, { workflows }: any) => {
          await workflows.registerWorkflow(workflow);
          
          const instance = await workflows.createInstance("timer.workflow", {
            userId: "user123",
            message: "Timer test",
          });

          // Check state after timer should have triggered
          setTimeout(async () => {
            try {
              const updatedInstance = await workflows.getInstance(instance.id);
              expect(updatedInstance?.currentState).toBe("notified");
              
              // Complete the workflow
              await workflows.transitionTo(instance.id, "completed");
              
              const finalInstance = await workflows.getInstance(instance.id);
              expect(finalInstance?.status).toBe(WorkflowStatus.COMPLETED);
              
              done();
            } catch (error) {
              done(error);
            }
          }, 100);

          return { instanceId: instance.id };
        },
      });

      run(app).then(({ dispose }) => {
        // Cleanup after test completes
        setTimeout(() => dispose(), 200);
      });
    });

    it("should provide access to adapter for testing", async () => {
      const app = resource({
        id: "adapter.test.app",
        register: [memoryWorkflowResource],
        dependencies: { workflows: memoryWorkflowResource },
        init: async (_: any, { workflows }: any) => {
          const adapter = workflows.getAdapter();
          expect(adapter).toBeInstanceOf(MemoryWorkflowAdapter);

          // Test adapter functionality directly
          const testInstance = {
            id: "test-direct",
            workflowId: "test",
            currentState: "test",
            status: WorkflowStatus.PENDING,
            context: {},
            executionHistory: [],
            activeTimers: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await adapter.saveInstance(testInstance);
          const loaded = await adapter.loadInstance("test-direct");
          expect(loaded).toEqual(testInstance);

          return { adapterType: adapter.constructor.name };
        },
      });

      const { value, dispose } = await run(app);
      expect((value as any).adapterType).toBe("MemoryWorkflowAdapter");
      await dispose();
    });
  });

  describe("resource lifecycle", () => {
    it("should dispose workflow engine when resource is disposed", async () => {
      const app = resource({
        id: "lifecycle.app",
        register: [memoryWorkflowResource],
        dependencies: { workflows: memoryWorkflowResource },
        init: async (_: any, { workflows }: any) => {
          // Create a workflow with timer to verify cleanup
          const workflow = defineWorkflow({
            id: "lifecycle.workflow",
            initialState: "start",
            states: ["start", "end"],
            transitions: [],
            steps: [],
            timers: [{
              id: "test.timer",
              duration: 1000,
              targetState: "end",
            }],
          });

          await workflows.registerWorkflow(workflow);
          await workflows.createInstance("lifecycle.workflow", {});

          return { engine: workflows.engine };
        },
      });

      const { value, dispose } = await run(app);
      const disposeSpy = jest.spyOn((value as any).engine, 'dispose');

      await dispose();

      expect(disposeSpy).toHaveBeenCalled();
    });
  });

  describe("OOP workflow pattern", () => {
    it("should work with Workflow classes", async () => {
      // Test workflow using OOP pattern
      class TestOrderWorkflow extends Workflow {
        constructor() {
          super({
            id: "test.oop.order.processing",
            initialState: "pending",
            states: ["pending", "validated", "completed"],
            steps: [],
            transitions: [
              { from: "pending", to: "validated" },
              { from: "validated", to: "completed" },
            ],
            finalStates: ["completed"],
          });
        }
      }

      const app = resource({
        id: "oop.test.app",
        register: [memoryWorkflowResource],
        dependencies: { workflows: memoryWorkflowResource },
        init: async (_: any, { workflows }: any) => {
          // Create and register workflow instance
          const orderWorkflow = new TestOrderWorkflow();
          expect(orderWorkflow.id).toBe("test.oop.order.processing");
          expect(orderWorkflow.initialState).toBe("pending");
          expect(orderWorkflow.states).toEqual(["pending", "validated", "completed"]);

          // Register the workflow
          await workflows.registerWorkflow(orderWorkflow);

          // Create workflow instance
          const instance = await workflows.createInstance(
            "test.oop.order.processing",
            { orderId: "test-123", amount: 99.99 }
          );

          expect(instance.workflowId).toBe("test.oop.order.processing");
          expect(instance.currentState).toBe("pending");
          expect(instance.context.orderId).toBe("test-123");

          // Test state transitions
          await workflows.transitionTo(instance.id, "validated");
          
          const validatedInstance = await workflows.getInstance(instance.id);
          expect(validatedInstance?.currentState).toBe("validated");

          await workflows.transitionTo(instance.id, "completed");
          
          const completedInstance = await workflows.getInstance(instance.id);
          expect(completedInstance?.currentState).toBe("completed");
          expect(completedInstance?.status).toBe(WorkflowStatus.COMPLETED);

          return { workflowId: orderWorkflow.id, instanceId: instance.id };
        },
      });

      const { value, dispose } = await run(app);
      expect((value as any).workflowId).toBe("test.oop.order.processing");
      await dispose();
    });

    it("should create workflow steps using helper methods", async () => {
      const validateTask = task({
        id: "validate.test.task",
        run: async (data: { orderId: string }) => {
          return { valid: true, orderId: data.orderId };
        },
      });

      class StepTestWorkflow extends Workflow {
        constructor() {
          super({
            id: "test.step.workflow", 
            initialState: "pending",
            states: ["pending", "validated", "completed"],
            steps: [
              // Use helper method to create step
            ],
            transitions: [
              { from: "pending", to: "validated", steps: ["validate"] },
              { from: "validated", to: "completed" },
            ],
            finalStates: ["completed"],
          });

          // Override steps to use helper method
          this.steps.push(this.createStep({
            id: "validate",
            task: validateTask,
            config: { timeout: 5000, retries: 2 },
          }));
        }
      }

      const app = resource({
        id: "step.test.app",
        register: [memoryWorkflowResource, validateTask],
        dependencies: { workflows: memoryWorkflowResource },
        init: async (_: any, { workflows }: any) => {
          const workflow = new StepTestWorkflow();
          expect(workflow.steps).toHaveLength(1);
          expect(workflow.steps[0].id).toBe("validate");
          expect(workflow.steps[0].config?.timeout).toBe(5000);
          expect(workflow.steps[0].config?.retries).toBe(2);

          await workflows.registerWorkflow(workflow);

          const instance = await workflows.createInstance("test.step.workflow", {
            orderId: "step-test-123",
          });

          // Execute step
          const result = await workflows.executeStep(instance.id, "validate", {
            orderId: "step-test-123",
          });

          expect(result.success).toBe(true);
          expect(result.output.valid).toBe(true);
          expect(result.output.orderId).toBe("step-test-123");

          return { stepCount: workflow.steps.length };
        },
      });

      const { value, dispose } = await run(app);
      expect((value as any).stepCount).toBe(1);
      await dispose();
    });
  });
});