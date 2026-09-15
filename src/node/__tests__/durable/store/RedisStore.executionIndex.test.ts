import { DurableOperator } from "../../../durable/core/DurableOperator";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import { encodeExecutionCursor } from "../../../durable/core/executionCursor";
import {
  executionIndexMember,
  executionQueryLimit,
} from "../../../durable/core/executionIndex";
import {
  serializer,
  setupRedisStoreMock,
} from "../helpers/RedisStore.mock.helpers";
import type { Execution } from "../../../durable/core/types";

const harness = setupRedisStoreMock();
const execution: Execution = {
  id: "id",
  workflowKey: "wf",
  status: "running",
  input: undefined,
  attempt: 1,
  maxAttempts: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("Redis metadata index contract", () => {
  it("reads exact IDs without execution payloads", async () => {
    const { store, redisMock } = harness;
    redisMock.eval
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(serializer.stringify(execution));
    expect(await store.getExecutionState("missing")).toBeNull();
    expect(await store.getExecutionState("id")).toEqual(execution);
    expect(redisMock.get).not.toHaveBeenCalled();
    redisMock.eval.mockResolvedValueOnce(
      "__error__:Execution index needs backfill",
    );
    await expect(store.getExecutionState("legacy")).rejects.toThrow("backfill");
  });
  it("uses bounded lexical queries and never scans or pipelines payloads", async () => {
    const { store, redisMock } = harness;
    redisMock.eval.mockResolvedValue([serializer.stringify(execution)]);
    expect(await store.listExecutionStates()).toEqual([execution]);
    const cursor = encodeExecutionCursor({
      createdAt: execution.createdAt.toISOString(),
      id: "id",
    });
    await store.listExecutionStates({
      limit: 40,
      workflowKey: "wf",
      status: ["running", "running", "sleeping"],
      cursor,
    });
    expect(redisMock.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('"zrangebylex"'),
      5,
      "durable:all_executions",
      "durable:execution_index_metadata",
      "durable:execution_index_states",
      'durable:execution_index:["wf","running"]',
      'durable:execution_index:["wf","sleeping"]',
      `(${executionIndexMember(execution)}`,
      40,
    );
    expect(redisMock.sscan).not.toHaveBeenCalled();
    expect(redisMock.pipeline).not.toHaveBeenCalled();
    redisMock.eval.mockResolvedValueOnce(
      "__error__:Execution index needs backfill",
    );
    await expect(store.listExecutionStates()).rejects.toThrow("needs backfill");
    redisMock.eval.mockResolvedValueOnce([42]);
    await expect(store.listExecutionStates()).rejects.toThrow();
  });

  it("backfills resumable batches and prunes stale members without racing recreations", async () => {
    const { store, redisMock } = harness;
    redisMock.sscan.mockResolvedValueOnce(["7", ["id", "missing"]]);
    redisMock.get
      .mockResolvedValueOnce(serializer.stringify(execution))
      .mockResolvedValueOnce(null);
    const operator = new DurableOperator(store);
    await expect(
      operator.listExecutionStates({ executionId: "id", cursor: "bad" }),
    ).rejects.toThrow("cannot be combined");
    expect(await operator.rebuildExecutionIndex()).toEqual({ nextCursor: "7" });
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining("~= ARGV[1]"),
      3,
      "durable:exec:id",
      "durable:execution_index_metadata",
      "durable:execution_index_states",
      serializer.stringify(execution),
      "id",
      "",
      "",
      "",
      expect.any(String),
      expect.any(String),
    );
    expect(redisMock.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('"exists"'),
      2,
      "durable:exec:missing",
      "durable:all_executions",
      "missing",
    );
    expect(
      await store.rebuildExecutionIndex({ cursor: "7", limit: 20 }),
    ).toEqual({ nextCursor: null });
    expect(redisMock.sscan).toHaveBeenLastCalledWith(
      "durable:all_executions",
      "7",
      "COUNT",
      20,
    );
    await expect(store.rebuildExecutionIndex({ limit: 0 })).rejects.toThrow(
      "backfill limit",
    );
    await expect(store.rebuildExecutionIndex({ limit: 1001 })).rejects.toThrow(
      "backfill limit",
    );
    await expect(store.rebuildExecutionIndex({ limit: 1.5 })).rejects.toThrow(
      "backfill limit",
    );
    for (const invalid of [null, [], [1, []], ["0", null], ["0", [2]]]) {
      redisMock.sscan.mockResolvedValueOnce(invalid);
      await expect(store.rebuildExecutionIndex()).rejects.toThrow();
    }
  });

  it("rejects unsupported and unbounded query work", async () => {
    for (const limit of [0, -1, 1.5, 1001, NaN])
      expect(() => executionQueryLimit({ limit })).toThrow(
        "Indexed execution limit",
      );
    expect(() => executionQueryLimit({ offset: 0 })).toThrow("not offset");
    expect(() => executionQueryLimit({ parentExecutionId: "p" })).toThrow(
      "parent filters",
    );
    await expect(
      new DurableOperator(new MemoryStore()).rebuildExecutionIndex(),
    ).rejects.toThrow("rebuildExecutionIndex");
    await expect(
      new DurableOperator(new MemoryStore()).listExecutionStates({
        limit: 1001,
      }),
    ).rejects.toThrow("1000");
  });

  it("supports indexed and custom-store fallback operators and exact identity lookups", async () => {
    const store = new MemoryStore();
    await store.saveExecution(execution);
    const operator = new DurableOperator(store);
    expect(
      (await operator.listExecutionStates({ executionId: "id" })).states,
    ).toHaveLength(1);
    expect(
      (
        await operator.listExecutionStates({
          executionId: "id",
          workflowKey: "wf",
          status: ["running"],
        })
      ).states,
    ).toHaveLength(1);
    expect(
      (
        await operator.listExecutionStates({
          executionId: "id",
          workflowKey: "other",
        })
      ).states,
    ).toHaveLength(0);
    expect(
      (
        await operator.listExecutionStates({
          executionId: "id",
          status: ["completed"],
        })
      ).states,
    ).toHaveLength(0);
    expect(
      (await operator.listExecutionStates({ executionId: "absent" })).states,
    ).toHaveLength(0);
    Object.defineProperty(store, "listExecutionStates", { value: undefined });
    Object.defineProperty(store, "getExecutionState", { value: undefined });
    expect(await operator.getExecutionState("id")).not.toBeNull();
    expect(await operator.getExecutionState("absent")).toBeNull();
    expect((await operator.listExecutionStates()).states).toHaveLength(1);
  });
});
