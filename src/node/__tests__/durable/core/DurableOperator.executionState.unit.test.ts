import { DurableOperator } from "../../../durable/core/DurableOperator";
import { compareExecutionsForListing } from "../../../durable/core/executionCursor";
import type { Execution } from "../../../durable/core/types";
import { MemoryStore } from "../../../durable/store/MemoryStore";

function shapeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function seedExecution(
  overrides: Partial<Execution> & { id: string },
): Execution {
  return {
    workflowKey: "t",
    input: undefined,
    status: "pending",
    attempt: 1,
    maxAttempts: 3,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("durable: DurableOperator execution state", () => {
  it("getExecutionState() returns the active summary without payloads", async () => {
    const store = new MemoryStore();
    const startedAt = new Date("2026-09-02T00:00:00.000Z");
    await store.saveExecution(
      seedExecution({
        id: "e1",
        status: "sleeping",
        input: { secret: "s3cr3t" },
        result: { secret: "s3cr3t" },
        error: { message: "s3cr3t" },
        current: {
          kind: "sleep",
          stepId: "nap",
          startedAt,
          waitingFor: {
            type: "sleep",
            params: {
              durationMs: 100,
              fireAtMs: startedAt.getTime() + 100,
              timerId: "t1",
            },
          },
        },
      }),
    );

    const state = await new DurableOperator(store).getExecutionState("e1");

    expect(state).toEqual({
      id: "e1",
      workflowKey: "t",
      parentExecutionId: undefined,
      status: "sleeping",
      attempt: 1,
      maxAttempts: 3,
      current: {
        kind: "sleep",
        stepId: "nap",
        startedAt,
        waitingFor: {
          type: "sleep",
          params: {
            durationMs: 100,
            fireAtMs: startedAt.getTime() + 100,
            timerId: "t1",
          },
        },
      },
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      completedAt: undefined,
    });
    expect(state).not.toHaveProperty("input");
    expect(state).not.toHaveProperty("result");
    expect(state).not.toHaveProperty("error");
  });

  it("getExecutionState() returns null for unknown executions", async () => {
    const state = await new DurableOperator(
      new MemoryStore(),
    ).getExecutionState("missing");
    expect(state).toBeNull();
  });

  it("listExecutionStates() pages newest-first with stable cursors", async () => {
    const store = new MemoryStore();
    for (let index = 1; index <= 5; index += 1) {
      await store.saveExecution(
        seedExecution({
          id: `e${index}`,
          createdAt: new Date(`2026-09-0${index}T00:00:00.000Z`),
          updatedAt: new Date(`2026-09-0${index}T00:00:00.000Z`),
        }),
      );
    }
    const operator = new DurableOperator(store);

    const first = await operator.listExecutionStates({ limit: 2 });
    expect(first.states.map((state) => state.id)).toEqual(["e5", "e4"]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await operator.listExecutionStates({
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.states.map((state) => state.id)).toEqual(["e3", "e2"]);
    expect(second.nextCursor).toEqual(expect.any(String));

    const third = await operator.listExecutionStates({
      limit: 2,
      cursor: second.nextCursor!,
    });
    expect(third.states.map((state) => state.id)).toEqual(["e1"]);
    expect(third.nextCursor).toBeNull();
  });

  it("listExecutionStates() orders same-timestamp rows by id", async () => {
    const store = new MemoryStore();
    for (const id of ["b", "a", "c"]) {
      await store.saveExecution(seedExecution({ id }));
    }
    const operator = new DurableOperator(store);

    const first = await operator.listExecutionStates({ limit: 2 });
    expect(first.states.map((state) => state.id)).toEqual(["a", "b"]);

    const second = await operator.listExecutionStates({
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.states.map((state) => state.id)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
  });

  it("listExecutionStates() applies status and workflowKey filters", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      seedExecution({ id: "e1", status: "completed", workflowKey: "orders" }),
    );
    await store.saveExecution(
      seedExecution({ id: "e2", status: "pending", workflowKey: "orders" }),
    );
    await store.saveExecution(
      seedExecution({ id: "e3", status: "pending", workflowKey: "billing" }),
    );
    const operator = new DurableOperator(store);

    const page = await operator.listExecutionStates({
      status: ["pending"],
      workflowKey: "orders",
    });
    expect(page.states.map((state) => state.id)).toEqual(["e2"]);
    expect(page.nextCursor).toBeNull();
  });

  it("listExecutionStates() fails fast on corrupt cursors", async () => {
    const operator = new DurableOperator(new MemoryStore());
    await expect(
      operator.listExecutionStates({ cursor: "not-a-cursor" }),
    ).rejects.toThrow("Invalid execution listing cursor.");
  });

  it("listExecutionStates() rejects invalid limits before reading the store", async () => {
    const operator = new DurableOperator(new MemoryStore());
    await expect(operator.listExecutionStates({ limit: 0 })).rejects.toThrow(
      "Durable operator limit must be a positive integer no greater than 1000. Received: 0.",
    );
    await expect(operator.listExecutionStates({ limit: 1.5 })).rejects.toThrow(
      "Durable operator limit must be a positive integer no greater than 1000. Received: 1.5.",
    );
  });

  it("listExecutionStates() rejects well-formed cursors with bad shapes", async () => {
    const operator = new DurableOperator(new MemoryStore());
    await expect(
      operator.listExecutionStates({ cursor: shapeCursor({ foo: 1 }) }),
    ).rejects.toThrow("Invalid execution listing cursor.");
    await expect(
      operator.listExecutionStates({
        cursor: shapeCursor({ createdAt: "not-a-date", id: "e1" }),
      }),
    ).rejects.toThrow("Invalid execution listing cursor.");
  });

  it("orders equal timestamps by id and identical executions as equal", () => {
    const first = seedExecution({ id: "e1" });
    const second = seedExecution({ id: "e2" });

    expect(compareExecutionsForListing(first, second)).toBe(-1);
    expect(compareExecutionsForListing(second, first)).toBe(1);
    expect(compareExecutionsForListing(first, { ...first })).toBe(0);
  });
});
