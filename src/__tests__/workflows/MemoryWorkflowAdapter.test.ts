/**
 * Test suite for the MemoryWorkflowAdapter
 */

import { MemoryWorkflowAdapter } from "../../workflows/adapters/MemoryWorkflowAdapter";
import { 
  IWorkflowInstance, 
  IWorkflowExecution, 
  WorkflowStatus, 
  WorkflowInstanceId 
} from "../../workflows/defs";

describe("MemoryWorkflowAdapter", () => {
  let adapter: MemoryWorkflowAdapter;
  let testInstance: IWorkflowInstance;
  let testExecution: IWorkflowExecution;

  beforeEach(() => {
    adapter = new MemoryWorkflowAdapter();
    
    testInstance = {
      id: "test-instance-1",
      workflowId: "test-workflow",
      currentState: "pending",
      status: WorkflowStatus.PENDING,
      context: { orderId: "123", amount: 99.99 },
      executionHistory: [],
      activeTimers: [],
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
    };

    testExecution = {
      id: "exec-1",
      stepId: "validate",
      fromState: "pending",
      toState: "validated",
      input: { orderId: "123" },
      output: { valid: true },
      status: "completed",
      startedAt: new Date("2024-01-01T00:00:00Z"),
      completedAt: new Date("2024-01-01T00:00:10Z"),
    };
  });

  describe("instance management", () => {
    it("should save and load workflow instances", async () => {
      await adapter.saveInstance(testInstance);
      const loaded = await adapter.loadInstance(testInstance.id);
      
      expect(loaded).toMatchObject({
        ...testInstance,
        updatedAt: expect.any(Date),
      });
      expect(loaded).not.toBe(testInstance); // Should be deep cloned
      expect(loaded?.updatedAt.getTime()).toBeGreaterThanOrEqual(testInstance.updatedAt.getTime());
    });

    it("should return null for non-existent instances", async () => {
      const loaded = await adapter.loadInstance("non-existent");
      expect(loaded).toBeNull();
    });

    it("should update existing instances", async () => {
      await adapter.saveInstance(testInstance);
      
      const updated = { ...testInstance, status: WorkflowStatus.RUNNING };
      await adapter.updateInstance(updated);
      
      const loaded = await adapter.loadInstance(testInstance.id);
      expect(loaded?.status).toBe(WorkflowStatus.RUNNING);
      expect(loaded?.updatedAt).toEqual(expect.any(Date));
    });

    it("should throw error when updating non-existent instance", async () => {
      await expect(adapter.updateInstance(testInstance))
        .rejects.toThrow("Workflow instance with ID test-instance-1 does not exist");
    });

    it("should delete instances", async () => {
      await adapter.saveInstance(testInstance);
      await adapter.deleteInstance(testInstance.id);
      
      const loaded = await adapter.loadInstance(testInstance.id);
      expect(loaded).toBeNull();
    });
  });

  describe("instance search", () => {
    beforeEach(async () => {
      const instances = [
        { ...testInstance, id: "inst-1", workflowId: "wf-1", status: WorkflowStatus.PENDING },
        { ...testInstance, id: "inst-2", workflowId: "wf-1", status: WorkflowStatus.RUNNING },
        { ...testInstance, id: "inst-3", workflowId: "wf-2", status: WorkflowStatus.COMPLETED },
        { 
          ...testInstance, 
          id: "inst-4", 
          workflowId: "wf-1", 
          status: WorkflowStatus.FAILED,
          createdAt: new Date("2023-01-01T00:00:00Z")
        },
      ];

      for (const instance of instances) {
        await adapter.saveInstance(instance);
      }
    });

    it("should find instances by workflow ID", async () => {
      const results = await adapter.findInstances({ workflowId: "wf-1" });
      expect(results).toHaveLength(3);
      expect(results.every(r => r.workflowId === "wf-1")).toBe(true);
    });

    it("should find instances by status", async () => {
      const results = await adapter.findInstances({ status: WorkflowStatus.RUNNING });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("inst-2");
    });

    it("should find instances by state", async () => {
      const results = await adapter.findInstances({ state: "pending" });
      expect(results).toHaveLength(4); // All test instances have "pending" state
    });

    it("should find instances by date range", async () => {
      const results = await adapter.findInstances({
        createdAfter: new Date("2023-12-31T00:00:00Z"),
      });
      expect(results).toHaveLength(3); // Excludes the 2023 instance
    });

    it("should combine multiple criteria", async () => {
      const results = await adapter.findInstances({
        workflowId: "wf-1",
        status: WorkflowStatus.PENDING,
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("inst-1");
    });

    it("should return empty array when no matches", async () => {
      const results = await adapter.findInstances({ workflowId: "non-existent" });
      expect(results).toHaveLength(0);
    });
  });

  describe("execution management", () => {
    beforeEach(async () => {
      await adapter.saveInstance(testInstance);
    });

    it("should save and load executions", async () => {
      await adapter.saveExecution(testInstance.id, testExecution);
      const executions = await adapter.loadExecutions(testInstance.id);
      
      expect(executions).toHaveLength(1);
      expect(executions[0]).toEqual(testExecution);
      expect(executions[0]).not.toBe(testExecution); // Should be deep cloned
    });

    it("should handle multiple executions for same instance", async () => {
      const execution2 = { ...testExecution, id: "exec-2", stepId: "payment" };
      
      await adapter.saveExecution(testInstance.id, testExecution);
      await adapter.saveExecution(testInstance.id, execution2);
      
      const executions = await adapter.loadExecutions(testInstance.id);
      expect(executions).toHaveLength(2);
    });

    it("should return empty array for instance with no executions", async () => {
      const executions = await adapter.loadExecutions(testInstance.id);
      expect(executions).toHaveLength(0);
    });

    it("should return empty array for non-existent instance", async () => {
      const executions = await adapter.loadExecutions("non-existent");
      expect(executions).toHaveLength(0);
    });
  });

  describe("cleanup", () => {
    beforeEach(async () => {
      const oldDate = new Date("2023-01-01T00:00:00Z");
      const newDate = new Date("2024-01-01T00:00:00Z");

      const instances = [
        { ...testInstance, id: "old-1", status: WorkflowStatus.COMPLETED, createdAt: oldDate },
        { ...testInstance, id: "old-2", status: WorkflowStatus.FAILED, createdAt: oldDate },
        { ...testInstance, id: "old-3", status: WorkflowStatus.RUNNING, createdAt: oldDate }, // Should not be cleaned
        { ...testInstance, id: "new-1", status: WorkflowStatus.COMPLETED, createdAt: newDate }, // Too recent
      ];

      for (const instance of instances) {
        await adapter.saveInstance(instance);
        // Add some executions
        await adapter.saveExecution(instance.id, { ...testExecution, id: `exec-${instance.id}` });
      }
    });

    it("should cleanup completed and failed instances older than cutoff", async () => {
      const cutoff = new Date("2023-12-31T00:00:00Z");
      const cleanedCount = await adapter.cleanup(cutoff);
      
      expect(cleanedCount).toBe(2); // old-1 and old-2
      
      // Verify remaining instances
      const remaining = adapter.getAllInstances();
      expect(remaining).toHaveLength(2);
      expect(remaining.map(r => r.id).sort()).toEqual(["new-1", "old-3"]);
      
      // Verify executions are also cleaned up
      const executions = adapter.getAllExecutions();
      expect(executions.size).toBe(2);
      expect(Array.from(executions.keys()).sort()).toEqual(["new-1", "old-3"]);
    });

    it("should not cleanup running instances regardless of age", async () => {
      const cutoff = new Date("2025-01-01T00:00:00Z"); // Future date that includes all old instances
      const cleanedCount = await adapter.cleanup(cutoff);
      
      expect(cleanedCount).toBe(3); // old-1, old-2, and new-1 (all completed/failed, excluding old-3 which is running)
    });
  });

  describe("utility methods", () => {
    beforeEach(async () => {
      await adapter.saveInstance(testInstance);
      await adapter.saveExecution(testInstance.id, testExecution);
    });

    it("should provide getAllInstances for testing", async () => {
      const instances = adapter.getAllInstances();
      expect(instances).toHaveLength(1);
      expect(instances[0]).toMatchObject({
        ...testInstance,
        updatedAt: expect.any(Date),
      });
    });

    it("should provide getAllExecutions for testing", () => {
      const executions = adapter.getAllExecutions();
      expect(executions.size).toBe(1);
      expect(executions.has(testInstance.id)).toBe(true);
    });

    it("should provide clear method for testing", async () => {
      adapter.clear();
      
      const instances = adapter.getAllInstances();
      const executions = adapter.getAllExecutions();
      
      expect(instances).toHaveLength(0);
      expect(executions.size).toBe(0);
    });

    it("should provide statistics", async () => {
      // Add more instances with different statuses
      const instances = [
        { ...testInstance, id: "inst-2", status: WorkflowStatus.RUNNING },
        { ...testInstance, id: "inst-3", status: WorkflowStatus.COMPLETED },
        { ...testInstance, id: "inst-4", status: WorkflowStatus.FAILED },
      ];

      for (const instance of instances) {
        await adapter.saveInstance(instance);
        await adapter.saveExecution(instance.id, { ...testExecution, id: `exec-${instance.id}` });
      }

      const stats = adapter.getStats();
      
      expect(stats.totalInstances).toBe(4);
      expect(stats.instancesByStatus[WorkflowStatus.PENDING]).toBe(1);
      expect(stats.instancesByStatus[WorkflowStatus.RUNNING]).toBe(1);
      expect(stats.instancesByStatus[WorkflowStatus.COMPLETED]).toBe(1);
      expect(stats.instancesByStatus[WorkflowStatus.FAILED]).toBe(1);
      expect(stats.totalExecutions).toBe(4);
    });
  });

  describe("data integrity", () => {
    it("should deep clone data to prevent mutations", async () => {
      await adapter.saveInstance(testInstance);
      
      // Mutate the original
      testInstance.status = WorkflowStatus.FAILED;
      testInstance.context.amount = 199.99;
      
      // Loaded data should be unchanged
      const loaded = await adapter.loadInstance(testInstance.id);
      expect(loaded?.status).toBe(WorkflowStatus.PENDING);
      expect(loaded?.context.amount).toBe(99.99);
    });

    it("should handle complex nested objects", async () => {
      const complexInstance = {
        ...testInstance,
        context: {
          order: {
            id: "123",
            items: [{ name: "Item 1", price: 50 }, { name: "Item 2", price: 49.99 }],
            metadata: { source: "web", timestamp: new Date() },
          },
          user: {
            id: "user-456",
            preferences: { notifications: true, theme: "dark" },
          },
        },
      };

      await adapter.saveInstance(complexInstance);
      const loaded = await adapter.loadInstance(complexInstance.id);
      
      expect(loaded?.context).toEqual(complexInstance.context);
      expect(loaded?.context).not.toBe(complexInstance.context);
    });

    it("should handle Date objects correctly", async () => {
      const now = new Date();
      const instanceWithDates = {
        ...testInstance,
        createdAt: now,
        updatedAt: now,
        context: { timestamp: now },
      };

      await adapter.saveInstance(instanceWithDates);
      const loaded = await adapter.loadInstance(instanceWithDates.id);
      
      expect(loaded?.createdAt).toEqual(now);
      expect(loaded?.createdAt).not.toBe(now);
      expect(loaded?.context.timestamp).toEqual(now);
      expect(loaded?.context.timestamp).not.toBe(now);
    });
  });
});