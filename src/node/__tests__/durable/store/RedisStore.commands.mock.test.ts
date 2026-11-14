import type { DurableCommandRecord } from "../../../durable/core/interfaces/commands";
import { pendingExecution } from "../helpers/DurableService.unit.helpers";
import {
  serializer,
  setupRedisStoreMock,
} from "../helpers/RedisStore.mock.helpers";

const harness = setupRedisStoreMock();
const command: DurableCommandRecord = {
  id: "request",
  executionId: "run",
  requestedExecutionId: "run",
  taskKey: "change",
  input: 1,
  status: "pending",
  createdAt: new Date(0),
};

describe("Redis command receipt contract", () => {
  it("reads stored receipts and FIFO heads without removing them", async () => {
    const { store, redisMock } = harness;
    expect(await store.getCommand("missing")).toBeNull();
    redisMock.hget.mockResolvedValue(serializer.stringify(command));
    expect(await store.getCommand(command.id)).toEqual(command);
    redisMock.eval
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(serializer.stringify(command));
    expect(await store.getNextCommand("run")).toBeNull();
    expect(await store.getNextCommand("run")).toEqual(command);
  });

  it("deduplicates admissions and retries only snapshot contention", async () => {
    const { store, redisMock } = harness;
    redisMock.hget.mockResolvedValueOnce(serializer.stringify(command));
    expect(await store.enqueueCommand(command)).toEqual(command);
    expect(redisMock.eval).not.toHaveBeenCalled();
    redisMock.get.mockResolvedValue(
      serializer.stringify(pendingExecution({ id: "run" })),
    );
    redisMock.eval
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(serializer.stringify(command));
    expect(await store.enqueueCommand(command)).toEqual(command);
    expect(redisMock.eval).toHaveBeenCalledTimes(2);
    redisMock.eval.mockResolvedValue(null);
    await expect(store.enqueueCommand(command)).rejects.toThrow(
      "stable execution snapshot",
    );
  });

  it("rejects stale, missing, closed and differently versioned targets", async () => {
    const { store, redisMock } = harness;
    await expect(store.enqueueCommand(command)).rejects.toThrow(
      "live execution",
    );
    for (const status of ["completed", "cancelling"] as const) {
      redisMock.get.mockResolvedValue(
        serializer.stringify(pendingExecution({ id: "run", status })),
      );
      await expect(store.enqueueCommand(command)).rejects.toThrow(
        "live execution",
      );
    }
    redisMock.get.mockResolvedValue(
      serializer.stringify(pendingExecution({ id: "run", workflowVersion: 2 })),
    );
    await expect(store.enqueueCommand(command)).rejects.toThrow(
      "accepted workflow version",
    );
  });

  it("requires a terminal receipt and a live expected snapshot before applying state", async () => {
    const { store, redisMock } = harness;
    await expect(store.completeCommand(command)).rejects.toThrow();
    await expect(
      store.saveCommand({ ...command, status: "completed" }),
    ).rejects.toThrow();
    expect(await store.saveCommand(command)).toBe(true);
    redisMock.eval.mockResolvedValueOnce(0);
    expect(await store.saveCommand({ ...command, status: "running" })).toBe(
      false,
    );
    const completed = { ...command, status: "completed" as const };
    expect(await store.completeCommand(completed)).toBe(false);
    for (const status of ["completed", "cancelling", "paused"] as const)
      expect(
        await store.completeCommand(
          completed,
          pendingExecution({ id: "run", status }),
        ),
      ).toBe(false);
    const expected = pendingExecution({ id: "run" });
    expect(await store.completeCommand(completed, expected)).toBe(false);
    redisMock.get.mockResolvedValue(
      serializer.stringify({ ...expected, attempt: 2 }),
    );
    expect(await store.completeCommand(completed, expected)).toBe(false);
    redisMock.get.mockResolvedValue(serializer.stringify(expected));
    expect(await store.completeCommand(completed, expected)).toBe(true);
    expect(
      await store.completeCommand(
        { ...completed, stateInitialized: true, state: null },
        expected,
      ),
    ).toBe(true);
    redisMock.get.mockResolvedValue(
      serializer.stringify({ ...expected, historyRecorded: true }),
    );
    expect(
      await store.completeCommand(
        { ...completed, stateInitialized: true, state: { value: { n: 3n } } },
        { ...expected, historyRecorded: true },
      ),
    ).toBe(true);
    expect(
      await store.completeCommand(
        { ...completed, stateInitialized: true, state: null },
        { ...expected, historyRecorded: true },
      ),
    ).toBe(true);
    redisMock.eval.mockResolvedValueOnce(0);
    expect(await store.completeCommand({ ...command, status: "failed" })).toBe(
      false,
    );
  });
});
