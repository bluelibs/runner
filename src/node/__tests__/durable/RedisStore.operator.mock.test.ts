import type { DurableAuditEntry } from "../../durable/core/audit";
import type { Execution, StepResult } from "../../durable/core/types";
import { serializer, setupRedisStoreMock } from "./RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

describe("durable: RedisStore operator helpers (mock)", () => {
  it("manages audit entries and paged reads", async () => {
    const { redisMock, store } = harness;
    const entry1: DurableAuditEntry = {
      id: "1704067200000:e1",
      executionId: "e1",
      at: new Date("2024-01-01T00:00:00.000Z"),
      attempt: 1,
      kind: "note",
      message: "first",
    };
    const entry2: DurableAuditEntry = {
      id: "1704153600000:e2",
      executionId: "e1",
      at: new Date("2024-01-02T00:00:00.000Z"),
      attempt: 1,
      kind: "note",
      message: "second",
    };

    await store.appendAuditEntry(entry1);
    await store.appendAuditEntry({ ...entry1, id: "", message: "needs-id" });
    redisMock.hgetall.mockResolvedValueOnce({});
    await expect(store.listAuditEntries("e1")).resolves.toEqual([]);

    redisMock.hgetall.mockResolvedValue({
      [entry2.id]: serializer.stringify(entry2),
      [entry1.id]: serializer.stringify(entry1),
    });
    await expect(store.listAuditEntries("e1")).resolves.toEqual([
      entry1,
      entry2,
    ]);
    await expect(
      store.listAuditEntries("e1", { offset: 1, limit: 1 }),
    ).resolves.toEqual([entry2]);

    redisMock.hgetall.mockResolvedValueOnce({ ignored: 123 } as any);
    await expect(store.listAuditEntries("e1")).resolves.toEqual([]);
  });

  it("manages direct and indexed step result reads", async () => {
    const { redisMock, store } = harness;
    await store.skipStep("e1", "s1");
    const step: StepResult<string> = {
      executionId: "e1",
      stepId: "s1",
      result: "ok",
      completedAt: new Date(),
    };

    await store.saveStepResult(step);
    redisMock.hget.mockResolvedValue(serializer.stringify(step));
    await expect(store.getStepResult("e1", "s1")).resolves.toEqual(step);
    redisMock.hget.mockResolvedValue(null);
    await expect(store.getStepResult("e1", "ghost")).resolves.toBeNull();

    redisMock.hget.mockResolvedValueOnce(
      serializer.stringify({
        executionId: "e1",
        stepId: "s-indexed",
        result: { ok: true },
        completedAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    );
    await expect(store.getStepResult("e1", "s-indexed")).resolves.toEqual(
      expect.objectContaining({ stepId: "s-indexed" }),
    );
  });

  it("lists step results and filters malformed hash entries", async () => {
    const { redisMock, store } = harness;
    redisMock.hgetall.mockResolvedValueOnce({
      s2: serializer.stringify({
        executionId: "e1",
        stepId: "s2",
        result: "late",
        completedAt: new Date("2024-01-02T00:00:00.000Z"),
      }),
      s1: serializer.stringify({
        executionId: "e1",
        stepId: "s1",
        result: "early",
        completedAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    });
    await expect(store.listStepResults("e1")).resolves.toEqual([
      expect.objectContaining({ stepId: "s1" }),
      expect.objectContaining({ stepId: "s2" }),
    ]);

    redisMock.hgetall.mockResolvedValueOnce({
      s2: serializer.stringify({
        executionId: "e1",
        stepId: "s2",
        result: 2,
        completedAt: new Date("2024-01-02T00:00:00.000Z"),
      }),
      ignored: 123,
      s1: serializer.stringify({
        executionId: "e1",
        stepId: "s1",
        result: 1,
        completedAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    } as any);
    await expect(store.listStepResults("e1")).resolves.toEqual([
      expect.objectContaining({ stepId: "s1" }),
      expect.objectContaining({ stepId: "s2" }),
    ]);

    redisMock.hgetall.mockResolvedValueOnce({});
    await expect(store.listStepResults("e1")).resolves.toEqual([]);
    redisMock.hgetall.mockResolvedValueOnce(null as any);
    await expect(store.listStepResults("e1")).resolves.toEqual([]);
    redisMock.hgetall.mockResolvedValueOnce({ ignored: 123 } as any);
    await expect(store.listStepResults("e1")).resolves.toEqual([]);
  });

  it("covers operator mutation helpers", async () => {
    const { redisMock, store } = harness;
    redisMock.get.mockResolvedValue(null);
    await store.retryRollback("missing");
    await store.forceFail("missing", { message: "x" });

    const execution: Execution = {
      id: "1",
      taskId: "t",
      input: undefined,
      status: "compensation_failed",
      error: { message: "boom", stack: "s" },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    redisMock.get.mockResolvedValue(serializer.stringify(execution));

    await store.retryRollback("1");
    await store.forceFail("1", { message: "manual", stack: "s" });
    await store.editStepResult("e1", "s1", { ok: true });
  });
});
