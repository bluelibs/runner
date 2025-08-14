/**
 * Test suite for workflow definition helpers
 */

import { 
  defineWorkflow, 
  defineWorkflowStep, 
  defineWorkflowTransition, 
  defineWorkflowTimer 
} from "../../workflows/define";
import { defineTask as task } from "../../define";

describe("Workflow Definition Helpers", () => {
  describe("defineWorkflow", () => {
    it("should create a workflow with all properties", () => {
      const mockTask = task({ id: "test.task", run: async () => "test" });
      
      const workflow = defineWorkflow({
        id: "order.processing",
        name: "Order Processing Workflow",
        description: "Handles order processing from validation to completion",
        initialState: "pending",
        states: ["pending", "validated", "paid", "completed", "failed"],
        transitions: [
          { from: "pending", to: "validated" },
          { from: "validated", to: "paid" },
        ],
        steps: [
          {
            id: "validate",
            task: mockTask,
            config: { timeout: 5000 },
          },
        ],
        timers: [
          {
            id: "payment_timeout",
            duration: 24 * 60 * 60 * 1000,
            targetState: "failed",
          },
        ],
        finalStates: ["completed", "failed"],
      });

      expect(workflow.id).toBe("order.processing");
      expect(workflow.name).toBe("Order Processing Workflow");
      expect(workflow.description).toBe("Handles order processing from validation to completion");
      expect(workflow.initialState).toBe("pending");
      expect(workflow.states).toEqual(["pending", "validated", "paid", "completed", "failed"]);
      expect(workflow.transitions).toHaveLength(2);
      expect(workflow.steps).toHaveLength(1);
      expect(workflow.timers).toHaveLength(1);
      expect(workflow.finalStates).toEqual(["completed", "failed"]);
    });

    it("should generate anonymous ID when not provided", () => {
      const workflow = defineWorkflow({
        initialState: "start",
        states: ["start", "end"],
        transitions: [],
        steps: [],
      });

      expect(workflow.id).toBeDefined();
      expect(typeof workflow.id).toBe("string");
      expect(workflow.id.length).toBeGreaterThan(0);
    });

    it("should handle minimal workflow definition", () => {
      const workflow = defineWorkflow({
        id: "minimal",
        initialState: "start",
        states: ["start"],
        transitions: [],
        steps: [],
      });

      expect(workflow.id).toBe("minimal");
      expect(workflow.initialState).toBe("start");
      expect(workflow.states).toEqual(["start"]);
      expect(workflow.transitions).toEqual([]);
      expect(workflow.steps).toEqual([]);
      expect(workflow.name).toBeUndefined();
      expect(workflow.description).toBeUndefined();
      expect(workflow.timers).toBeUndefined();
      expect(workflow.finalStates).toBeUndefined();
    });
  });

  describe("defineWorkflowStep", () => {
    it("should create a step with all properties", () => {
      const mockTask = task({ id: "validate.order", run: async (input: any) => ({ valid: true }) });
      const rollbackTask = task({ id: "rollback.validation", run: async () => undefined });

      const step = defineWorkflowStep({
        id: "validate",
        name: "Validate Order",
        description: "Validates the order data",
        config: {
          timeout: 5000,
          retries: 2,
          parallel: false,
          rollbackable: true,
          dependencies: ["user-service"],
        },
        task: mockTask,
        rollbackTask,
      });

      expect(step.id).toBe("validate");
      expect(step.name).toBe("Validate Order");
      expect(step.description).toBe("Validates the order data");
      expect(step.config?.timeout).toBe(5000);
      expect(step.config?.retries).toBe(2);
      expect(step.config?.parallel).toBe(false);
      expect(step.config?.rollbackable).toBe(true);
      expect(step.config?.dependencies).toEqual(["user-service"]);
      expect(step.task).toBe(mockTask);
      expect(step.rollbackTask).toBe(rollbackTask);
    });

    it("should create a minimal step", () => {
      const mockTask = task({ id: "simple.task", run: async () => "result" });

      const step = defineWorkflowStep({
        id: "simple",
        task: mockTask,
      });

      expect(step.id).toBe("simple");
      expect(step.task).toBe(mockTask);
      expect(step.name).toBeUndefined();
      expect(step.description).toBeUndefined();
      expect(step.config).toBeUndefined();
      expect(step.rollbackTask).toBeUndefined();
    });
  });

  describe("defineWorkflowTransition", () => {
    it("should create a transition with all properties", () => {
      const condition = async (context: any, stepOutput: any) => context.amount > 100;

      const transition = defineWorkflowTransition({
        from: "pending",
        to: "validated",
        condition,
        steps: ["validate", "enrich"],
        rollbackable: true,
      });

      expect(transition.from).toBe("pending");
      expect(transition.to).toBe("validated");
      expect(transition.condition).toBe(condition);
      expect(transition.steps).toEqual(["validate", "enrich"]);
      expect(transition.rollbackable).toBe(true);
    });

    it("should create a minimal transition", () => {
      const transition = defineWorkflowTransition({
        from: "start",
        to: "end",
      });

      expect(transition.from).toBe("start");
      expect(transition.to).toBe("end");
      expect(transition.condition).toBeUndefined();
      expect(transition.steps).toBeUndefined();
      expect(transition.rollbackable).toBeUndefined();
    });
  });

  describe("defineWorkflowTimer", () => {
    it("should create a timer with all properties", () => {
      const timerTask = task({ id: "reminder.task", run: async (context: any) => "reminder sent" });

      const timer = defineWorkflowTimer({
        id: "payment_reminder",
        duration: 2 * 60 * 60 * 1000, // 2 hours
        targetState: "reminded",
        task: timerTask,
        recurring: true,
      });

      expect(timer.id).toBe("payment_reminder");
      expect(timer.duration).toBe(2 * 60 * 60 * 1000);
      expect(timer.targetState).toBe("reminded");
      expect(timer.task).toBe(timerTask);
      expect(timer.recurring).toBe(true);
    });

    it("should create a minimal timer", () => {
      const timer = defineWorkflowTimer({
        id: "timeout",
        duration: 30000,
        targetState: "expired",
      });

      expect(timer.id).toBe("timeout");
      expect(timer.duration).toBe(30000);
      expect(timer.targetState).toBe("expired");
      expect(timer.task).toBeUndefined();
      expect(timer.recurring).toBeUndefined();
    });
  });

  describe("integration", () => {
    it("should create a complete workflow with all components", () => {
      // Define tasks
      const validateTask = task({
        id: "validate.order",
        run: async (input: { orderId: string }) => ({ valid: true, orderId: input.orderId }),
      });

      const paymentTask = task({
        id: "process.payment",
        run: async (input: { amount: number }) => ({ paymentId: "pay_123", amount: input.amount }),
      });

      const rollbackTask = task({
        id: "rollback.payment",
        run: async (input: { paymentId: string }) => undefined,
      });

      // Define workflow components
      const validateStep = defineWorkflowStep({
        id: "validate",
        name: "Validate Order",
        task: validateTask,
        config: { timeout: 5000, retries: 2 },
      });

      const paymentStep = defineWorkflowStep({
        id: "payment",
        name: "Process Payment",
        task: paymentTask,
        rollbackTask,
        config: { timeout: 30000, rollbackable: true },
      });

      const validationTransition = defineWorkflowTransition({
        from: "pending",
        to: "validated",
        steps: ["validate"],
      });

      const paymentTransition = defineWorkflowTransition({
        from: "validated",
        to: "paid",
        steps: ["payment"],
        condition: async (context) => context.amount > 0,
      });

      const timeoutTimer = defineWorkflowTimer({
        id: "payment_timeout",
        duration: 24 * 60 * 60 * 1000,
        targetState: "failed",
      });

      // Create complete workflow
      const workflow = defineWorkflow({
        id: "order.processing",
        name: "Order Processing",
        description: "Complete order processing workflow",
        initialState: "pending",
        states: ["pending", "validated", "paid", "completed", "failed"],
        steps: [validateStep, paymentStep],
        transitions: [validationTransition, paymentTransition],
        timers: [timeoutTimer],
        finalStates: ["completed", "failed"],
      });

      // Verify the complete workflow
      expect(workflow.id).toBe("order.processing");
      expect(workflow.steps).toHaveLength(2);
      expect(workflow.transitions).toHaveLength(2);
      expect(workflow.timers).toHaveLength(1);
      expect(workflow.states).toContain("pending");
      expect(workflow.states).toContain("failed");
      
      // Verify step references
      expect(workflow.steps.find(s => s.id === "validate")?.task).toBe(validateTask);
      expect(workflow.steps.find(s => s.id === "payment")?.rollbackTask).toBe(rollbackTask);
      
      // Verify transition references
      expect(workflow.transitions.find(t => t.from === "pending")?.steps).toContain("validate");
      expect(workflow.transitions.find(t => t.from === "validated")?.condition).toBeDefined();
    });
  });
});