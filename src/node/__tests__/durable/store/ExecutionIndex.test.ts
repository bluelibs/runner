import { MemoryStore } from "../../../durable/store/MemoryStore";
import { DurableOperator } from "../../../durable/core/DurableOperator";
import { OrderedKeys } from "../../../durable/store/memory-store/OrderedKeys";
import { IndexedExecutions } from "../../../durable/store/memory-store/IndexedExecutions";
import { encodeExecutionCursor } from "../../../durable/core/executionCursor";
import type { Execution } from "../../../durable/core/types";

function execution(index: number): Execution {
  return {
    id: `run-${String(index).padStart(6, "0")}`,
    workflowKey: `workflow-${index % 50}`,
    status: index < 20 ? "running" : "completed",
    input: { secret: true },
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(1700000000000 + Math.floor(index / 3)),
    updatedAt: new Date(1700000000000),
  };
}

describe("indexed execution pages", () => {
  it("pages 100,000 executions without scanning payloads or snapshotting each write", async () => {
    const store = new MemoryStore();
    const snapshots = jest.spyOn(store, "exportSnapshot");
    for (let index = 0; index < 100000; index++)
      await store.saveExecution(execution(index));
    expect(snapshots).not.toHaveBeenCalled();
    const legacy = jest
      .spyOn(store, "listExecutions")
      .mockRejectedValue(new Error("Full scan forbidden"));
    const payload = jest
      .spyOn(store, "getExecution")
      .mockRejectedValue(new Error("Payload read forbidden"));
    const operator = new DurableOperator(store);
    expect(
      (await operator.listExecutionStates({ executionId: "run-000001" }))
        .states,
    ).toHaveLength(1);
    let cursor: string | undefined;
    const ids = new Set<string>();
    do {
      const page = await operator.listExecutionStates({ limit: 1000, cursor });
      expect(page.states.length).toBeLessThanOrEqual(1000);
      for (const state of page.states) {
        expect(state).not.toHaveProperty("input");
        ids.add(state.id);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids.size).toBe(100000);
    expect(legacy).not.toHaveBeenCalled();
    expect(payload).not.toHaveBeenCalled();
    const live = await operator.listExecutionStates({
      status: ["running", "running", "sleeping"],
    });
    expect(live.states).toHaveLength(20);
    const workflow = await operator.listExecutionStates({
      workflowKey: "workflow-19",
      status: ["running"],
    });
    expect(workflow.states.map((state) => state.id)).toEqual(["run-000019"]);
  }, 30000);

  it("keeps cursors stable across inserts, status changes, snapshots, and tied timestamps", async () => {
    const store = new MemoryStore();
    const operator = new DurableOperator(store);
    for (let index = 0; index < 5; index++)
      await store.saveExecution(execution(index));
    const first = await operator.listExecutionStates({ limit: 2 });
    expect(first.states.map((row) => row.id)).toEqual([
      "run-000003",
      "run-000004",
    ]);
    await store.saveExecution(execution(10));
    await store.updateExecution("run-000001", { status: "failed" });
    expect(
      (
        await operator.listExecutionStates({
          limit: 2,
          cursor: first.nextCursor!,
        })
      ).states.map((row) => row.id),
    ).toEqual(["run-000000", "run-000001"]);
    expect(
      await store.listExecutionStates({ status: ["failed"] }),
    ).toHaveLength(1);
    await store.updateExecution("run-000001", { attempt: 2 });
    const snapshot = store.exportSnapshot();
    const restored = new MemoryStore();
    restored.restoreSnapshot(snapshot);
    expect(await restored.listExecutionStates()).toEqual(
      await store.listExecutionStates(),
    );
    const rows = await restored.listExecutionStates();
    rows[0].createdAt.setTime(0);
    expect(
      (await restored.listExecutionStates())[0].createdAt.getTime(),
    ).not.toBe(0);
    expect(
      await store.listExecutions({
        cursor: encodeExecutionCursor({
          createdAt: execution(3).createdAt.toISOString(),
          id: execution(3).id,
        }),
      }),
    ).toHaveLength(4);
  });

  it("maintains bounded sorted blocks under insertion, deletion, duplication and misses", () => {
    const keys = new OrderedKeys();
    expect(keys.page("", 10)).toEqual([]);
    keys.delete("absent");
    for (let index = 1100; index >= 0; index--)
      keys.add(String(index).padStart(5, "0"));
    keys.add("00500");
    keys.delete("00500a");
    keys.delete("99999");
    expect(keys.page("00499", 2)).toEqual(["00500", "00501"]);
    for (let index = 0; index <= 1100; index++)
      keys.delete(String(index).padStart(5, "0"));
    expect(keys.page("", 3)).toEqual([]);
    const records = new IndexedExecutions();
    records.set("run-000001", execution(1));
    expect(records.delete("absent")).toBe(false);
    expect(records.delete("run-000001")).toBe(true);
    records.set("run-000002", execution(2));
    records.clear();
    expect(records.listStates({ workflowKey: "missing" })).toEqual([]);
  });
});
