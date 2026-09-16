import { DurableOperator } from "../../../durable/core/DurableOperator";
import type { IDurableStore } from "../../../durable/core/interfaces/store";
import { ExecutionStatus, type Execution } from "../../../durable/core/types";
import {
  deleteWorkflowsBefore,
  fetchWorkflowsBefore,
} from "../../../durable/core/workflowRetention";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import { createBareStore } from "../helpers/DurableService.unit.helpers";

function createExecution(
  overrides: Partial<Execution> & {
    id: string;
    workflowKey: string;
    status: Execution["status"];
  },
): Execution {
  const { id, workflowKey, status, ...rest } = overrides;
  return {
    input: undefined,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...rest,
    id,
    workflowKey,
    status,
  };
}

describe("durable: DurableOperator workflow retention", () => {
  it("fetches archive-safe workflows older than a cutoff", async () => {
    const store = new MemoryStore();
    const operator = new DurableOperator(store);
    const now = new Date("2026-01-05T00:00:00.000Z");

    for (const execution of [
      createExecution({
        id: "fresh-1",
        workflowKey: "orders",
        status: ExecutionStatus.Completed,
        createdAt: new Date("2026-01-05T00:00:05.000Z"),
        updatedAt: new Date("2026-01-05T00:00:05.000Z"),
        completedAt: new Date("2026-01-05T00:00:05.000Z"),
      }),
      createExecution({
        id: "fresh-2",
        workflowKey: "orders",
        status: ExecutionStatus.Failed,
        createdAt: new Date("2026-01-05T00:00:04.000Z"),
        updatedAt: new Date("2026-01-05T00:00:04.000Z"),
        completedAt: new Date("2026-01-05T00:00:04.000Z"),
      }),
      createExecution({
        id: "ignored-stuck",
        workflowKey: "orders",
        status: ExecutionStatus.CompensationFailed,
        createdAt: new Date("2026-01-05T00:00:03.000Z"),
        updatedAt: new Date("2025-12-01T00:00:00.000Z"),
      }),
      createExecution({
        id: "old-1",
        workflowKey: "orders",
        status: ExecutionStatus.Completed,
        createdAt: new Date("2026-01-05T00:00:02.000Z"),
        updatedAt: new Date("2025-12-01T00:00:00.000Z"),
        completedAt: new Date("2025-12-01T00:00:00.000Z"),
      }),
      createExecution({
        id: "old-2",
        workflowKey: "orders",
        status: ExecutionStatus.Cancelled,
        createdAt: new Date("2026-01-05T00:00:01.000Z"),
        updatedAt: new Date("2025-12-02T00:00:00.000Z"),
      }),
    ]) {
      await store.saveExecution(execution);
    }

    await expect(operator.fetchWorkflowsBefore(now, 2)).resolves.toEqual([
      expect.objectContaining({ id: "old-1" }),
      expect.objectContaining({ id: "old-2" }),
    ]);
    await expect(operator.fetchWorkflowsBefore(now, 5)).resolves.toEqual([
      expect.objectContaining({ id: "old-1" }),
      expect.objectContaining({ id: "old-2" }),
    ]);
  });

  it("validates workflow retention inputs and empty scans", async () => {
    const operator = new DurableOperator(new MemoryStore());

    await expect(
      operator.fetchWorkflowsBefore(new Date("invalid"), 1),
    ).rejects.toThrow("retention cutoff");
    await expect(operator.fetchWorkflowsBefore(new Date(), 0)).rejects.toThrow(
      "retention limit",
    );
    await expect(operator.fetchWorkflowsBefore(new Date(), 1)).resolves.toEqual(
      [],
    );
  });

  it("uses the default fetch limit on operator and helper paths", async () => {
    const store = new MemoryStore();
    const operator = new DurableOperator(store);
    const cutoff = new Date("2026-01-05T00:00:00.000Z");

    await expect(operator.fetchWorkflowsBefore(cutoff)).resolves.toEqual([]);
    await expect(fetchWorkflowsBefore(store, cutoff)).resolves.toEqual([]);
  });

  it("deletes only workflows still eligible at deletion time", async () => {
    const store = new MemoryStore();
    const operator = new DurableOperator(store);
    const cutoff = new Date("2026-01-05T00:00:00.000Z");

    for (const execution of [
      createExecution({
        id: "delete-me",
        workflowKey: "orders",
        status: ExecutionStatus.Completed,
        createdAt: new Date("2026-01-05T00:00:03.000Z"),
        updatedAt: new Date("2025-12-01T00:00:00.000Z"),
        completedAt: new Date("2025-12-01T00:00:00.000Z"),
      }),
      createExecution({
        id: "delete-cancelled",
        workflowKey: "orders",
        status: ExecutionStatus.Cancelled,
        createdAt: new Date("2026-01-05T00:00:02.500Z"),
        updatedAt: new Date("2025-12-01T12:00:00.000Z"),
        completedAt: new Date("2025-12-01T12:00:00.000Z"),
      }),
      createExecution({
        id: "missing-now",
        workflowKey: "orders",
        status: ExecutionStatus.Completed,
        createdAt: new Date("2026-01-05T00:00:02.000Z"),
        updatedAt: new Date("2025-12-02T00:00:00.000Z"),
        completedAt: new Date("2025-12-02T00:00:00.000Z"),
      }),
      createExecution({
        id: "fresh-now",
        workflowKey: "orders",
        status: ExecutionStatus.Failed,
        createdAt: new Date("2026-01-05T00:00:01.000Z"),
        updatedAt: new Date("2025-12-03T00:00:00.000Z"),
        completedAt: new Date("2025-12-03T00:00:00.000Z"),
      }),
    ]) {
      await store.saveExecution(execution);
    }

    const originalGetExecution = store.getExecution.bind(store);
    jest.spyOn(store, "getExecution").mockImplementation(async (id) => {
      if (id === "missing-now") {
        return null;
      }
      if (id === "fresh-now") {
        return createExecution({
          id,
          workflowKey: "orders",
          status: ExecutionStatus.Failed,
          createdAt: new Date("2026-01-05T00:00:01.000Z"),
          updatedAt: new Date("2026-01-06T00:00:00.000Z"),
          completedAt: new Date("2026-01-06T00:00:00.000Z"),
        });
      }
      return await originalGetExecution(id);
    });

    await expect(operator.deleteWorkflowsBefore(cutoff, 10)).resolves.toEqual([
      "delete-me",
      "delete-cancelled",
    ]);
    await expect(store.getExecution("delete-me")).resolves.toBeNull();
    await expect(store.getExecution("delete-cancelled")).resolves.toBeNull();
    await expect(store.getExecution("missing-now")).resolves.toBeNull();
    await expect(store.getExecution("fresh-now")).resolves.toEqual(
      expect.objectContaining({ id: "fresh-now" }),
    );
  });

  it("requires deleteExecutionData support before deleting workflows", async () => {
    const store: IDurableStore = createBareStore(new MemoryStore());
    const operator = new DurableOperator(store);

    await expect(operator.deleteWorkflowsBefore(new Date())).rejects.toThrow(
      "deleteExecutionData",
    );
  });

  it("uses the default delete limit on the helper path", async () => {
    const store = new MemoryStore();

    await expect(deleteWorkflowsBefore(store, new Date())).resolves.toEqual([]);
  });
});
