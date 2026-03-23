import { r } from "../../..";
import { DurableExecutionRepository } from "../../durable/core/DurableExecutionRepository";
import { DurableOperator } from "../../durable/core/DurableOperator";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { durableWorkflowTag } from "../../durable/tags/durableWorkflow.tag";
import type { ITask } from "../../../types/task";

function createRepository<TInput, TResult>(
  task: ITask<TInput, Promise<TResult>, any, any, any, any>,
  workflowKey: string,
  store: MemoryStore,
): DurableExecutionRepository<TInput, TResult> {
  return new DurableExecutionRepository<TInput, TResult>({
    task,
    store,
    operator: new DurableOperator(store),
    runnerStore: {
      resolveDefinitionId: jest
        .fn()
        .mockImplementation((reference) =>
          reference === task ? workflowKey : undefined,
        ),
      tasks: new Map([[workflowKey, { task }]]),
    } as any,
  });
}

describe("durable: DurableExecutionRepository", () => {
  it("supports input filters, date ranges, sorting, skip, and limit", async () => {
    const task = r
      .task("durable-tests-repository-query-options")
      .inputSchema<{ order: { id: string; region: string } }>({
        parse: (value: any) => value,
      })
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async () => "ok")
      .build();
    const store = new MemoryStore();
    const repository = createRepository(task, "app.tasks.query-options", store);
    const base = new Date("2025-01-01T00:00:00.000Z");

    await store.saveExecution({
      id: "exec-1",
      workflowKey: "app.tasks.query-options",
      input: { order: { id: "o-1", region: "eu" } },
      status: "pending",
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date(base.getTime()),
      updatedAt: new Date(base.getTime() + 1_000),
    });
    await store.saveExecution({
      id: "exec-2",
      workflowKey: "app.tasks.query-options",
      input: { order: { id: "o-2", region: "us" } },
      status: "completed",
      attempt: 2,
      maxAttempts: 3,
      createdAt: new Date(base.getTime() + 10_000),
      updatedAt: new Date(base.getTime() + 11_000),
      completedAt: new Date(base.getTime() + 12_000),
    });
    await store.saveExecution({
      id: "exec-3",
      workflowKey: "app.tasks.query-options",
      input: { order: { id: "o-3", region: "eu" } },
      status: "completed",
      attempt: 3,
      maxAttempts: 4,
      createdAt: new Date(base.getTime() + 20_000),
      updatedAt: new Date(base.getTime() + 21_000),
      completedAt: new Date(base.getTime() + 22_000),
    });

    await expect(
      repository.find(
        {
          input: { order: { region: "eu" } },
          createdAt: { $gte: base },
        },
        {
          sort: { createdAt: 1 },
          skip: 1,
          limit: 1,
        },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({ id: "exec-3" }),
      }),
    ]);

    await expect(
      repository.find({
        completedAt: { $gt: new Date(base.getTime() + 15_000) },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({ id: "exec-3" }),
      }),
    ]);
  });

  it("applies collection options only to findTree roots", async () => {
    const task = r
      .task("durable-tests-repository-tree-options")
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async () => "ok")
      .build();
    const store = new MemoryStore();
    const repository = createRepository(task, "app.tasks.tree-options", store);

    await store.saveExecution({
      id: "root-1",
      workflowKey: "app.tasks.tree-options",
      input: { orderId: "o-1" },
      status: "completed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:01.000Z"),
      completedAt: new Date("2025-01-01T00:00:02.000Z"),
    });
    await store.saveExecution({
      id: "root-2",
      workflowKey: "app.tasks.tree-options",
      input: { orderId: "o-2" },
      status: "completed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      updatedAt: new Date("2025-01-02T00:00:01.000Z"),
      completedAt: new Date("2025-01-02T00:00:02.000Z"),
    });
    await store.saveExecution({
      id: "child-2",
      workflowKey: "app.tasks.child",
      parentExecutionId: "root-2",
      input: { step: "child" },
      status: "completed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date("2025-01-02T01:00:00.000Z"),
      updatedAt: new Date("2025-01-02T01:00:01.000Z"),
      completedAt: new Date("2025-01-02T01:00:02.000Z"),
    });

    await expect(
      repository.findTree(
        {},
        {
          sort: { createdAt: 1 },
          skip: 1,
          limit: 1,
        },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({ id: "root-2" }),
        children: [
          expect.objectContaining({
            execution: expect.objectContaining({ id: "child-2" }),
          }),
        ],
      }),
    ]);
  });

  it("fails fast on invalid query options and unsupported date operators", async () => {
    const task = r
      .task("durable-tests-repository-invalid-query")
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async () => "ok")
      .build();
    const store = new MemoryStore();
    const repository = createRepository(task, "app.tasks.invalid-query", store);

    await expect(
      repository.find({}, { sort: { createdAt: 1, updatedAt: -1 } }),
    ).rejects.toThrow(
      'Durable repository sort for task "app.tasks.invalid-query" supports exactly one date field at a time. Received: createdAt, updatedAt.',
    );

    await expect(
      repository.find({
        createdAt: { $bad: new Date("2025-01-01T00:00:00.000Z") } as any,
      }),
    ).rejects.toThrow(
      'Durable repository received unsupported date filter operator "$bad". Allowed operators are $gt, $gte, $lt, $lte.',
    );

    await expect(
      repository.find({
        createdAt: {} as any,
      }),
    ).rejects.toThrow(
      "Durable repository date range filters must include at least one of $gt, $gte, $lt, or $lte.",
    );

    await expect(
      repository.find({
        createdAt: { $gt: "2025-01-01" as any },
      }),
    ).rejects.toThrow(
      'Durable repository received an invalid $gt value for {"$gt":"2025-01-01"}. Expected a valid Date instance.',
    );
  });
});
