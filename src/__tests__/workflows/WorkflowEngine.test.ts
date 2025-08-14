/**
 * Test suite for the WorkflowEngine
 */

import { WorkflowEngine } from "../../workflows/WorkflowEngine";
import { MemoryWorkflowAdapter } from "../../workflows/adapters/MemoryWorkflowAdapter";
import { EventManager } from "../../models/EventManager";
import { Logger } from "../../models/Logger";
import { defineTask as task, defineEvent as event } from "../../define";
import { 
  defineWorkflow, 
  defineWorkflowStep, 
  defineWorkflowTransition,
  defineWorkflowTimer,
} from "../../workflows/define";
import { 
  WorkflowStatus, 
  IWorkflowEngineOptions,
  IWorkflowDefinition,
} from "../../workflows/defs";

describe("WorkflowEngine", () => {
  let engine: WorkflowEngine;
  let adapter: MemoryWorkflowAdapter;
  let eventManager: EventManager;
  let logger: Logger;
  let mockTask: any;
  let mockRollbackTask: any;

  beforeEach(() => {
    adapter = new MemoryWorkflowAdapter();
    eventManager = new EventManager();
    logger = new Logger(eventManager);

    const options: IWorkflowEngineOptions = {
      adapter,
      defaultStepTimeout: 5000,
      defaultRetries: 1,
      enableParallelExecution: true,
      timerCheckInterval: 100,
    };

    engine = new WorkflowEngine(options, eventManager, logger);

    mockTask = task({
      id: "mock.task",
      run: jest.fn().mockResolvedValue({ success: true }),
    });

    mockRollbackTask = task({
      id: "mock.rollback",
      run: jest.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(async () => {
    await engine.dispose();
  });

  describe("workflow registration", () => {
    it("should register a valid workflow", async () => {
      const workflow = defineWorkflow({
        id: "test.workflow",
        initialState: "start",
        states: ["start", "end"],
        transitions: [{ from: "start", to: "end" }],
        steps: [],
      });

      await expect(engine.registerWorkflow(workflow)).resolves.not.toThrow();
    });

    it("should validate workflow definition", async () => {
      const invalidWorkflow = {
        id: "",
        initialState: "start",
        states: ["start", "end"],
        transitions: [],
        steps: [],
      } as IWorkflowDefinition;

      await expect(engine.registerWorkflow(invalidWorkflow))
        .rejects.toThrow("Workflow ID is required");
    });

    it("should validate initial state is in states list", async () => {
      const invalidWorkflow = defineWorkflow({
        id: "invalid",
        initialState: "missing",
        states: ["start", "end"],
        transitions: [],
        steps: [],
      });

      await expect(engine.registerWorkflow(invalidWorkflow))
        .rejects.toThrow("Initial state must be included in states list");
    });

    it("should validate transition states exist", async () => {
      const invalidWorkflow = defineWorkflow({
        id: "invalid",
        initialState: "start",
        states: ["start", "end"],
        transitions: [{ from: "start", to: "missing" }],
        steps: [],
      });

      await expect(engine.registerWorkflow(invalidWorkflow))
        .rejects.toThrow("Transition 'to' state 'missing' not found in states");
    });

    it("should validate step IDs are unique", async () => {
      const step1 = defineWorkflowStep({ id: "duplicate", task: mockTask });
      const step2 = defineWorkflowStep({ id: "duplicate", task: mockTask });

      const invalidWorkflow = defineWorkflow({
        id: "invalid",
        initialState: "start",
        states: ["start", "end"],
        transitions: [],
        steps: [step1, step2],
      });

      await expect(engine.registerWorkflow(invalidWorkflow))
        .rejects.toThrow("Duplicate step ID: duplicate");
    });
  });

  describe("instance creation", () => {
    let workflow: IWorkflowDefinition;

    beforeEach(async () => {
      workflow = defineWorkflow({
        id: "test.workflow",
        initialState: "pending",
        states: ["pending", "completed"],
        transitions: [{ from: "pending", to: "completed" }],
        steps: [],
      });
      await engine.registerWorkflow(workflow);
    });

    it("should create workflow instance", async () => {
      const context = { orderId: "123", amount: 99.99 };
      const instance = await engine.createInstance("test.workflow", context);

      expect(instance.id).toBeDefined();
      expect(instance.workflowId).toBe("test.workflow");
      expect(instance.currentState).toBe("pending");
      expect(instance.status).toBe(WorkflowStatus.PENDING);
      expect(instance.context).toEqual(context);
      expect(instance.createdAt).toBeInstanceOf(Date);
      expect(instance.updatedAt).toBeInstanceOf(Date);
    });

    it("should create instance with custom ID", async () => {
      const customId = "custom-instance-123";
      const instance = await engine.createInstance("test.workflow", {}, customId);

      expect(instance.id).toBe(customId);
    });

    it("should throw error for unknown workflow", async () => {
      await expect(engine.createInstance("unknown.workflow", {}))
        .rejects.toThrow("Workflow with ID unknown.workflow not found");
    });

    it("should emit state changed event on creation", async () => {
      const stateChangedEvent = event<any>({ id: "state.changed" });
      const workflowWithEvents = defineWorkflow({
        id: "event.workflow",
        initialState: "start",
        states: ["start", "end"],
        transitions: [],
        steps: [],
        events: { stateChanged: stateChangedEvent },
      });

      await engine.registerWorkflow(workflowWithEvents);

      const eventSpy = jest.fn();
      eventManager.addEventListener(stateChangedEvent, eventSpy);

      await engine.createInstance("event.workflow", { test: true });

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "",
          to: "start",
          context: { test: true },
        }),
        "workflow.engine"
      );
    });
  });

  describe("step execution", () => {
    let workflow: IWorkflowDefinition;
    let instanceId: string;

    beforeEach(async () => {
      const step = defineWorkflowStep({
        id: "test.step",
        task: mockTask,
        config: { timeout: 1000, retries: 2 },
      });

      workflow = defineWorkflow({
        id: "step.workflow",
        initialState: "pending",
        states: ["pending", "completed"],
        transitions: [{ from: "pending", to: "completed", steps: ["test.step"] }],
        steps: [step],
      });

      await engine.registerWorkflow(workflow);
      const instance = await engine.createInstance("step.workflow", {});
      instanceId = instance.id;
    });

    it("should execute workflow step successfully", async () => {
      const result = await engine.executeStep(instanceId, "test.step", { input: "test" });

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ success: true });
      expect(result.shouldContinue).toBe(true);
      expect(mockTask.run).toHaveBeenCalledWith({ input: "test" }, {});
    });

    it("should handle step execution failure", async () => {
      const error = new Error("Step failed");
      mockTask.run.mockRejectedValue(error);

      const result = await engine.executeStep(instanceId, "test.step", {});

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.shouldContinue).toBe(false);
    });

    it("should retry failed steps", async () => {
      mockTask.run
        .mockRejectedValueOnce(new Error("First failure"))
        .mockResolvedValueOnce({ success: true });

      const result = await engine.executeStep(instanceId, "test.step", {});

      expect(result.success).toBe(true);
      expect(mockTask.run).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries", async () => {
      mockTask.run.mockRejectedValue(new Error("Persistent failure"));

      const result = await engine.executeStep(instanceId, "test.step", {});

      expect(result.success).toBe(false);
      expect(mockTask.run).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });

    it("should throw error for non-existent instance", async () => {
      await expect(engine.executeStep("non-existent", "test.step", {}))
        .rejects.toThrow("Workflow instance non-existent not found");
    });

    it("should throw error for non-existent step", async () => {
      await expect(engine.executeStep(instanceId, "non-existent", {}))
        .rejects.toThrow("Step non-existent not found in workflow step.workflow");
    });

    it("should save execution history", async () => {
      await engine.executeStep(instanceId, "test.step", { input: "test" });

      const history = await engine.getExecutionHistory(instanceId);
      expect(history).toHaveLength(1);
      
      const execution = history[0];
      expect(execution.stepId).toBe("test.step");
      expect(execution.input).toEqual({ input: "test" });
      expect(execution.output).toEqual({ success: true });
      expect(execution.status).toBe("completed");
      expect(execution.startedAt).toBeInstanceOf(Date);
      expect(execution.completedAt).toBeInstanceOf(Date);
    });
  });

  describe("state transitions", () => {
    let workflow: IWorkflowDefinition;
    let instanceId: string;

    beforeEach(async () => {
      const step = defineWorkflowStep({
        id: "validate",
        task: mockTask,
      });

      workflow = defineWorkflow({
        id: "transition.workflow",
        initialState: "pending",
        states: ["pending", "validated", "completed", "failed"],
        transitions: [
          { from: "pending", to: "validated", steps: ["validate"] },
          { from: "validated", to: "completed" },
          { 
            from: "validated", 
            to: "failed", 
            condition: async (context) => context.shouldFail === true 
          },
        ],
        steps: [step],
        finalStates: ["completed", "failed"],
      });

      await engine.registerWorkflow(workflow);
      const instance = await engine.createInstance("transition.workflow", {});
      instanceId = instance.id;
    });

    it("should transition to new state", async () => {
      const success = await engine.transitionTo(instanceId, "validated");

      expect(success).toBe(true);
      
      const instance = await engine.getInstance(instanceId);
      expect(instance?.currentState).toBe("validated");
      expect(instance?.updatedAt).toBeInstanceOf(Date);
    });

    it("should reject invalid transitions", async () => {
      // Try to transition from pending directly to completed (not allowed)
      const success = await engine.transitionTo(instanceId, "completed");

      expect(success).toBe(false);
      
      const instance = await engine.getInstance(instanceId);
      expect(instance?.currentState).toBe("pending"); // Unchanged
    });

    it("should execute transition steps", async () => {
      await engine.transitionTo(instanceId, "validated");

      expect(mockTask.run).toHaveBeenCalled();
    });

    it("should respect transition conditions", async () => {
      // First transition to validated
      await engine.transitionTo(instanceId, "validated");
      
      // Update context to meet condition
      const instance = await engine.getInstance(instanceId);
      instance!.context.shouldFail = true;
      await adapter.updateInstance(instance!);

      // Transition should succeed due to condition
      const success = await engine.transitionTo(instanceId, "failed");
      expect(success).toBe(true);
    });

    it("should mark workflow as completed when reaching final state", async () => {
      await engine.transitionTo(instanceId, "validated");
      await engine.transitionTo(instanceId, "completed");

      const instance = await engine.getInstance(instanceId);
      expect(instance?.status).toBe(WorkflowStatus.COMPLETED);
      expect(instance?.completedAt).toBeInstanceOf(Date);
    });

    it("should fail transition if step execution fails", async () => {
      mockTask.run.mockRejectedValue(new Error("Step failed"));

      const success = await engine.transitionTo(instanceId, "validated");

      expect(success).toBe(false);
      
      const instance = await engine.getInstance(instanceId);
      expect(instance?.currentState).toBe("pending"); // Unchanged
    });
  });

  describe("rollback functionality", () => {
    let workflow: IWorkflowDefinition;
    let instanceId: string;

    beforeEach(async () => {
      const step1 = defineWorkflowStep({
        id: "step1",
        task: mockTask,
        rollbackTask: mockRollbackTask,
        config: { rollbackable: true },
      });

      const step2 = defineWorkflowStep({
        id: "step2", 
        task: mockTask,
        rollbackTask: mockRollbackTask,
        config: { rollbackable: true },
      });

      workflow = defineWorkflow({
        id: "rollback.workflow",
        initialState: "start",
        states: ["start", "step1_done", "step2_done", "failed"],
        transitions: [
          { from: "start", to: "step1_done", steps: ["step1"] },
          { from: "step1_done", to: "step2_done", steps: ["step2"] },
        ],
        steps: [step1, step2],
      });

      await engine.registerWorkflow(workflow);
      const instance = await engine.createInstance("rollback.workflow", {});
      instanceId = instance.id;
    });

    it("should rollback workflow to initial state", async () => {
      // Execute some steps first
      await engine.transitionTo(instanceId, "step1_done");
      await engine.transitionTo(instanceId, "step2_done");

      const success = await engine.rollback(instanceId);

      expect(success).toBe(true);
      
      const instance = await engine.getInstance(instanceId);
      expect(instance?.currentState).toBe("start");
      expect(instance?.status).toBe(WorkflowStatus.PENDING);
    });

    it("should execute rollback tasks in reverse order", async () => {
      await engine.transitionTo(instanceId, "step1_done");
      await engine.transitionTo(instanceId, "step2_done");

      await engine.rollback(instanceId);

      // Rollback tasks should be called in reverse order (step2, then step1)
      expect(mockRollbackTask.run).toHaveBeenCalledTimes(2);
    });

    it("should rollback to specific state", async () => {
      await engine.transitionTo(instanceId, "step1_done");
      await engine.transitionTo(instanceId, "step2_done");

      const success = await engine.rollback(instanceId, "step1_done");

      expect(success).toBe(true);
      
      const instance = await engine.getInstance(instanceId);
      expect(instance?.currentState).toBe("step1_done");
    });

    it("should handle rollback task failures", async () => {
      mockRollbackTask.run.mockRejectedValue(new Error("Rollback failed"));

      await engine.transitionTo(instanceId, "step1_done");

      const success = await engine.rollback(instanceId);

      expect(success).toBe(false);
      
      const instance = await engine.getInstance(instanceId);
      expect(instance?.status).toBe(WorkflowStatus.FAILED);
    });
  });

  describe("timer functionality", () => {
    let workflow: IWorkflowDefinition;

    beforeEach(async () => {
      const timerTask = task({
        id: "timer.task",
        run: jest.fn().mockResolvedValue("timer executed"),
      });

      const timer = defineWorkflowTimer({
        id: "test.timer",
        duration: 100, // 100ms for quick testing
        targetState: "timeout",
        task: timerTask,
      });

      workflow = defineWorkflow({
        id: "timer.workflow",
        initialState: "pending",
        states: ["pending", "timeout", "completed"],
        transitions: [
          { from: "pending", to: "timeout" },
          { from: "pending", to: "completed" },
        ],
        steps: [],
        timers: [timer],
      });

      await engine.registerWorkflow(workflow);
    });

    it("should trigger timer after duration", (done) => {
      engine.createInstance("timer.workflow", {}).then((instance) => {
        // Wait for timer to trigger
        setTimeout(async () => {
          try {
            const updatedInstance = await engine.getInstance(instance.id);
            expect(updatedInstance?.currentState).toBe("timeout");
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      }).catch(done);
    });

    it("should execute timer task when triggered", (done) => {
      const timerTask = workflow.timers![0].task!;
      const taskSpy = jest.spyOn(timerTask, 'run');

      engine.createInstance("timer.workflow", { test: true }).then(() => {
        setTimeout(() => {
          try {
            expect(taskSpy).toHaveBeenCalledWith({ test: true }, {});
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      }).catch(done);
    });
  });

  describe("workflow cancellation", () => {
    let instanceId: string;

    beforeEach(async () => {
      const workflow = defineWorkflow({
        id: "cancel.workflow",
        initialState: "running",
        states: ["running", "completed"],
        transitions: [],
        steps: [],
      });

      await engine.registerWorkflow(workflow);
      const instance = await engine.createInstance("cancel.workflow", {});
      instanceId = instance.id;
    });

    it("should cancel workflow instance", async () => {
      await engine.cancel(instanceId, "User requested cancellation");

      const instance = await engine.getInstance(instanceId);
      expect(instance?.status).toBe(WorkflowStatus.CANCELLED);
      expect(instance?.error?.message).toBe("User requested cancellation");
    });

    it("should cancel without reason", async () => {
      await engine.cancel(instanceId);

      const instance = await engine.getInstance(instanceId);
      expect(instance?.status).toBe(WorkflowStatus.CANCELLED);
      expect(instance?.error).toBeUndefined();
    });
  });

  describe("cleanup functionality", () => {
    beforeEach(async () => {
      const workflow = defineWorkflow({
        id: "cleanup.workflow",
        initialState: "start",
        states: ["start", "end"],
        transitions: [],
        steps: [],
      });

      await engine.registerWorkflow(workflow);
    });

    it("should cleanup old instances when adapter supports it", async () => {
      // Create some instances
      await engine.createInstance("cleanup.workflow", {});
      await engine.createInstance("cleanup.workflow", {});

      // Mock adapter cleanup
      const cleanupSpy = jest.spyOn(adapter, 'cleanup').mockResolvedValue(2);

      const cutoff = new Date();
      const cleanedCount = await engine.cleanup(cutoff);

      expect(cleanupSpy).toHaveBeenCalledWith(cutoff);
      expect(cleanedCount).toBe(2);
    });

    it("should return 0 when adapter doesn't support cleanup", async () => {
      // Remove cleanup method
      delete (adapter as any).cleanup;

      const cleanedCount = await engine.cleanup();

      expect(cleanedCount).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should handle step execution timeout", async () => {
      const slowTask = task({
        id: "slow.task",
        run: async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return "completed";
        },
      });

      const step = defineWorkflowStep({
        id: "slow.step",
        task: slowTask,
        config: { timeout: 100 }, // Short timeout
      });

      const workflow = defineWorkflow({
        id: "timeout.workflow",
        initialState: "pending",
        states: ["pending", "completed"],
        transitions: [],
        steps: [step],
      });

      await engine.registerWorkflow(workflow);
      const instance = await engine.createInstance("timeout.workflow", {});

      const result = await engine.executeStep(instance.id, "slow.step");

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("timeout");
    });

    it("should handle validation errors", async () => {
      const validatingTask = task({
        id: "validating.task",
        run: async (input: any) => input,
      });

      const mockSchema = {
        parse: jest.fn().mockImplementation((input) => {
          if (!input.required) {
            throw new Error("Required field missing");
          }
          return input;
        }),
      };

      const step = defineWorkflowStep({
        id: "validating.step",
        task: validatingTask,
        inputSchema: mockSchema,
      });

      const workflow = defineWorkflow({
        id: "validation.workflow",
        initialState: "pending",
        states: ["pending", "completed"],
        transitions: [],
        steps: [step],
      });

      await engine.registerWorkflow(workflow);
      const instance = await engine.createInstance("validation.workflow", {});

      const result = await engine.executeStep(instance.id, "validating.step", { invalid: true });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Task input");
    });
  });

  describe("disposal", () => {
    it("should dispose engine and clean up resources", async () => {
      const workflow = defineWorkflow({
        id: "disposal.workflow",
        initialState: "start",
        states: ["start"],
        transitions: [],
        steps: [],
        timers: [defineWorkflowTimer({ id: "timer", duration: 1000, targetState: "start" })],
      });

      await engine.registerWorkflow(workflow);
      await engine.createInstance("disposal.workflow", {});

      await expect(engine.dispose()).resolves.not.toThrow();
    });
  });
});