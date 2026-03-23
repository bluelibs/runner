import { r } from "../../..";
import { DurableExecutionRepository } from "../../durable/core/DurableExecutionRepository";
import { DurableOperator } from "../../durable/core/DurableOperator";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { durableWorkflowTag } from "../../durable/tags/durableWorkflow.tag";
import type { ITask } from "../../../types/task";
import { createBareStore } from "./DurableService.unit.helpers";

function createTask<TInput = unknown, TResult = string>(
  id: string,
  options?: {
    durable?: boolean;
    run?: (input: TInput) => Promise<TResult>;
  },
): ITask<TInput, Promise<TResult>, any, any, any, any> {
  let builder = r.task(id);
  if (options?.durable !== false) {
    builder = builder.tags([durableWorkflowTag.with({ category: "coverage" })]);
  }
  const run = options?.run ?? (async () => "ok" as TResult);

  return builder.run(run).build() as ITask<
    TInput,
    Promise<TResult>,
    any,
    any,
    any,
    any
  >;
}

function createRepository<TInput, TResult>(
  task: ITask<TInput, Promise<TResult>, any, any, any, any>,
  workflowKey: string,
  store: IDurableStore,
  runnerStoreOverrides?: Partial<{
    resolveDefinitionId: (reference: unknown) => string | undefined;
    tasks: Map<string, { task: unknown }>;
  }>,
): DurableExecutionRepository<TInput, TResult> {
  return new DurableExecutionRepository<TInput, TResult>({
    task,
    store,
    operator: new DurableOperator(store),
    runnerStore: {
      resolveDefinitionId:
        runnerStoreOverrides?.resolveDefinitionId ??
        jest
          .fn()
          .mockImplementation((reference) =>
            reference === task ? workflowKey : undefined,
          ),
      tasks: runnerStoreOverrides?.tasks ?? new Map([[workflowKey, { task }]]),
    } as any,
  });
}

describe("durable: DurableExecutionRepository coverage", () => {
  it("fails fast when the task cannot be resolved or is not durable", () => {
    const store = new MemoryStore();
    const task = createTask("durable-tests-repository-missing-runtime");

    expect(() =>
      createRepository(task, "app.tasks.missing-runtime", store, {
        resolveDefinitionId: () => undefined,
      }),
    ).toThrow(
      'Cannot create a durable repository for task "durable-tests-repository-missing-runtime": the task is not registered in the runtime store.',
    );

    expect(() =>
      createRepository(task, "app.tasks.missing-store-task", store, {
        tasks: new Map(),
      }),
    ).toThrow(
      'Cannot create a durable repository for task "app.tasks.missing-store-task": the task is not registered in the runtime store.',
    );

    expect(() =>
      createRepository(
        createTask("durable-tests-repository-not-durable", {
          durable: false,
        }),
        "app.tasks.not-durable",
        store,
      ),
    ).toThrow(
      'Cannot create a durable repository for task "app.tasks.not-durable": the task is not tagged with tags.durableWorkflow.',
    );

    expect(
      () =>
        new DurableExecutionRepository({
          task: {} as any,
          store,
          operator: new DurableOperator(store),
          runnerStore: {
            resolveDefinitionId: () => undefined,
            tasks: new Map(),
          } as any,
        }),
    ).toThrow(
      'Cannot create a durable repository for task "undefined": the task is not registered in the runtime store.',
    );
  });

  it("covers unmatched single reads, empty sort options, and pagination without limit", async () => {
    const task = createTask("durable-tests-repository-basic");
    const store = new MemoryStore();
    const repository = createRepository(task, "app.tasks.basic", store);

    await store.saveExecution({
      id: "newer",
      workflowKey: "app.tasks.basic",
      input: undefined,
      status: "completed",
      attempt: 2,
      maxAttempts: 3,
      createdAt: new Date("2025-01-02T00:00:00.000Z"),
      updatedAt: new Date("2025-01-02T00:00:01.000Z"),
      completedAt: new Date("2025-01-02T00:00:02.000Z"),
    });
    await store.saveExecution({
      id: "older",
      workflowKey: "app.tasks.basic",
      parentExecutionId: "parent-1",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:01.000Z"),
    });

    await expect(repository.findOne()).resolves.toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({ id: "newer" }),
      }),
    );
    await expect(repository.find()).resolves.toHaveLength(2);
    await expect(repository.findTree()).resolves.toHaveLength(2);
    await expect(repository.findOne({ id: "missing" })).resolves.toBeNull();
    await expect(repository.findOneOrFail()).resolves.toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({ id: "newer" }),
      }),
    );
    await expect(repository.findOneOrFail({ id: "missing" })).rejects.toThrow(
      'No durable execution matched task "app.tasks.basic" and query {"id":"missing"}.',
    );

    await expect(repository.find({}, { sort: {}, skip: 1 })).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({ id: "older" }),
      }),
    ]);

    await expect(
      repository.find({
        parentExecutionId: "parent-1",
        attempt: 1,
        maxAttempts: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({ id: "older" }),
      }),
    ]);
    await expect(repository.find({ attempt: 999 })).resolves.toEqual([]);
    await expect(repository.find({ maxAttempts: 999 })).resolves.toEqual([]);
    await expect(repository.find({}, { skip: 1 })).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({ id: "older" }),
      }),
    ]);
  });

  it("covers paged list loading and date filter branches", async () => {
    const task = createTask("durable-tests-repository-pages");
    const store = new MemoryStore();
    const repository = createRepository(task, "app.tasks.pages", store);
    const total = 501;
    const baseMs = new Date("2025-01-01T00:00:00.000Z").getTime();

    for (let index = 0; index < total; index += 1) {
      await store.saveExecution({
        id: `exec-${index}`,
        workflowKey: "app.tasks.pages",
        input: undefined,
        status: "completed",
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(baseMs + index),
        updatedAt: new Date(baseMs + index + 10_000),
        completedAt: new Date(baseMs + index + 20_000),
      });
    }

    const paged = await repository.find({}, { sort: { createdAt: 1 } });
    expect(paged).toHaveLength(total);
    expect(paged[0]?.execution.id).toBe("exec-0");
    expect(paged[500]?.execution.id).toBe("exec-500");

    await expect(
      repository.find({
        createdAt: new Date(baseMs + 500),
        updatedAt: { $lt: new Date(baseMs + 10_001) },
        completedAt: { $lte: new Date(baseMs + 20_000) },
      }),
    ).resolves.toEqual([]);

    await expect(
      repository.find({
        createdAt: { $gte: new Date(baseMs + 499) },
        updatedAt: { $lt: new Date(baseMs + 10_502) },
        completedAt: { $lte: new Date(baseMs + 20_500) },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({ id: "exec-500" }),
      }),
      expect.objectContaining({
        execution: expect.objectContaining({ id: "exec-499" }),
      }),
    ]);

    await store.saveExecution({
      id: "no-completion",
      workflowKey: "app.tasks.pages",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(baseMs - 1),
      updatedAt: new Date(baseMs - 1),
    });

    await expect(
      repository.find({}, { sort: { completedAt: 1 }, limit: 1 }),
    ).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({ id: "no-completion" }),
      }),
    ]);

    await expect(
      repository.find({
        completedAt: { $lte: new Date(baseMs + 19_999) },
      }),
    ).resolves.toEqual([]);
  });

  it("rejects invalid filters and query options", async () => {
    const task = createTask("durable-tests-repository-validation");
    const store = new MemoryStore();
    const repository = createRepository(task, "app.tasks.validation", store);

    await expect(repository.find({}, { skip: -1 })).rejects.toThrow(
      "Durable repository skip must be >= 0. Received: -1.",
    );
    await expect(repository.find({}, { limit: 0 })).rejects.toThrow(
      "Durable repository limit must be > 0. Received: 0.",
    );
    await expect(
      repository.find({
        createdAt: "not-a-date" as any,
      }),
    ).rejects.toThrow(
      'Durable repository received an invalid createdAt filter: "not-a-date".',
    );
  });

  it("covers input matching branches and tree hydration fallback paths", async () => {
    const task = createTask<
      {
        values: string[];
        timestamp: Date;
        meta: { ok: boolean };
      },
      string
    >("durable-tests-repository-inputs");
    const base = new MemoryStore();
    const store = createBareStore(base, {
      getExecution: async (id) =>
        id === "fallback-root" ? null : await base.getExecution(id),
      listAuditEntries: undefined,
    });
    const repository = createRepository(task, "app.tasks.inputs", store);

    await base.saveExecution({
      id: "fallback-root",
      workflowKey: "app.tasks.inputs",
      input: {
        values: ["a", "b"],
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        meta: { ok: true },
      },
      status: "completed",
      attempt: 1,
      maxAttempts: 2,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:01.000Z"),
      completedAt: new Date("2025-01-01T00:00:02.000Z"),
    });
    await base.saveExecution({
      id: "child",
      workflowKey: "app.tasks.child",
      parentExecutionId: "fallback-root",
      input: {
        values: ["a", "b"],
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        meta: { ok: true },
      },
      status: "completed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date("2025-01-01T01:00:00.000Z"),
      updatedAt: new Date("2025-01-01T01:00:01.000Z"),
      completedAt: new Date("2025-01-01T01:00:02.000Z"),
    });
    await base.saveExecution({
      id: "grandchild",
      workflowKey: "app.tasks.grandchild",
      parentExecutionId: "child",
      input: {
        values: ["a", "b"],
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        meta: { ok: true },
      },
      status: "completed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date("2025-01-01T02:00:00.000Z"),
      updatedAt: new Date("2025-01-01T02:00:01.000Z"),
      completedAt: new Date("2025-01-01T02:00:02.000Z"),
    });
    await base.saveExecution({
      id: "object-mismatch",
      workflowKey: "app.tasks.inputs",
      input: {
        values: ["a", "b"],
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        meta: "not-an-object" as any,
      },
      status: "completed",
      attempt: 2,
      maxAttempts: 2,
      createdAt: new Date("2025-01-03T00:00:00.000Z"),
      updatedAt: new Date("2025-01-03T00:00:01.000Z"),
      completedAt: new Date("2025-01-03T00:00:02.000Z"),
    });

    await expect(
      repository.find({
        input: {
          values: ["a", "b"],
          timestamp: new Date("2025-01-01T00:00:00.000Z"),
          meta: { ok: true },
        },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({ id: "fallback-root" }),
        audit: [],
      }),
    ]);

    await expect(
      repository.find({ input: { values: ["a"] } }),
    ).resolves.toEqual([]);
    await expect(
      repository.find({ input: { meta: { ok: false } } }),
    ).resolves.toEqual([]);
    await expect(
      repository.find({ input: { meta: { ok: true }, values: ["a", "c"] } }),
    ).resolves.toEqual([]);
    await expect(
      repository.find({ input: { meta: { ok: true } } }),
    ).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({ id: "fallback-root" }),
      }),
    ]);

    await expect(repository.findTree({ id: "fallback-root" })).resolves.toEqual(
      [
        expect.objectContaining({
          execution: expect.objectContaining({ id: "fallback-root" }),
          audit: [],
          children: [
            expect.objectContaining({
              execution: expect.objectContaining({ id: "child" }),
              children: [
                expect.objectContaining({
                  execution: expect.objectContaining({ id: "grandchild" }),
                }),
              ],
            }),
          ],
        }),
      ],
    );

    await expect(
      repository.findTree({ id: "object-mismatch" }),
    ).resolves.toEqual([
      expect.objectContaining({
        execution: expect.objectContaining({ id: "object-mismatch" }),
        children: [],
      }),
    ]);
  });
});
