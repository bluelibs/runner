import { ExecutionStatus } from "../../../durable/core/types";
import {
  serializer,
  setupRedisStoreMock,
} from "../helpers/RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

describe("durable: RedisStore execution indexes (mock)", () => {
  it("lists executions, incomplete executions, and stuck executions through indexes", async () => {
    const { redisMock, store } = harness;
    redisMock.sscan.mockResolvedValue(["0", ["1", "2"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [
          null,
          serializer.stringify({
            id: "1",
            workflowKey: "t1",
            status: "completed",
            createdAt: new Date("2024-01-02T00:00:00.000Z"),
          }),
        ],
        [
          null,
          serializer.stringify({
            id: "2",
            workflowKey: "t1",
            status: "completed",
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
          }),
        ],
      ]),
    });
    await expect(
      store.listExecutions({ workflowKey: "t1", status: ["completed"] }),
    ).resolves.toHaveLength(2);

    redisMock.sscan.mockResolvedValue(["0", ["1", "2", "3"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, serializer.stringify({ id: "1", status: "running" })],
        [null, serializer.stringify({ id: "2", status: "completed" })],
        [null, null],
      ]),
    });
    await expect(store.listIncompleteExecutions()).resolves.toEqual([
      expect.objectContaining({ id: "1" }),
    ]);
    expect(redisMock.srem).toHaveBeenCalledWith(
      "durable:active_executions",
      "3",
    );
    expect(redisMock.srem).toHaveBeenCalledWith(
      "durable:active_executions",
      "2",
    );

    redisMock.sscan.mockResolvedValue(["0", ["stuck-1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [
          null,
          serializer.stringify({
            id: "stuck-1",
            workflowKey: "t-stuck",
            input: undefined,
            status: ExecutionStatus.CompensationFailed,
            attempt: 1,
            maxAttempts: 1,
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
            updatedAt: new Date("2024-01-01T00:00:00.000Z"),
          }),
        ],
      ]),
    } as any);
    await expect(store.listStuckExecutions()).resolves.toEqual([
      expect.objectContaining({ id: "stuck-1" }),
    ]);
  });

  it("handles empty, null, and malformed dashboard/index reads", async () => {
    const { redisMock, store } = harness;
    const badPipeline = {
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    };

    redisMock.sscan.mockResolvedValueOnce("bad" as any);
    await expect(store.listIncompleteExecutions()).rejects.toThrow("SCAN");
    redisMock.sscan.mockResolvedValueOnce([1, []] as any);
    await expect(store.listIncompleteExecutions()).rejects.toThrow("SCAN");
    redisMock.sscan.mockResolvedValueOnce(["0", [1]] as any);
    await expect(store.listIncompleteExecutions()).rejects.toThrow("SCAN");

    redisMock.sscan.mockResolvedValueOnce(["0", []]);
    await expect(store.listExecutions()).resolves.toEqual([]);

    redisMock.sscan.mockResolvedValueOnce(["0", ["1"]]);
    redisMock.pipeline.mockReturnValueOnce(badPipeline as any);
    await expect(store.listExecutions()).resolves.toEqual([]);

    redisMock.sscan.mockResolvedValueOnce(["0", ["1"]]);
    redisMock.pipeline.mockReturnValueOnce({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 123]]),
    } as any);
    await expect(store.listExecutions()).resolves.toEqual([]);

    redisMock.sscan.mockResolvedValueOnce(["0", ["1"]]);
    redisMock.pipeline.mockReturnValueOnce(badPipeline as any);
    await expect(store.listIncompleteExecutions()).resolves.toEqual([]);

    redisMock.sscan.mockResolvedValueOnce(["0", ["1"]]);
    redisMock.pipeline.mockReturnValueOnce({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, null]]),
    } as any);
    await expect(store.listIncompleteExecutions()).resolves.toEqual([]);

    redisMock.sscan.mockResolvedValueOnce(["0", ["1", "2"]]);
    redisMock.srem.mockRejectedValueOnce(new Error("srem-failed"));
    redisMock.pipeline.mockReturnValueOnce({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, serializer.stringify({ id: "1", status: "running" })],
        [null, serializer.stringify({ id: "2", status: "completed" })],
      ]),
    } as any);
    await expect(store.listIncompleteExecutions()).resolves.toHaveLength(1);

    redisMock.sscan.mockResolvedValueOnce(["0", []]);
    await expect(store.listIncompleteExecutions()).resolves.toEqual([]);

    redisMock.sscan.mockResolvedValueOnce(["0", ["1", "2"]]);
    redisMock.pipeline.mockReturnValueOnce({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, null],
        [
          null,
          serializer.stringify({ id: "1", status: "compensation_failed" }),
        ],
      ]),
    } as any);
    await expect(store.listStuckExecutions()).resolves.toEqual([
      expect.objectContaining({ id: "1" }),
    ]);

    redisMock.sscan.mockResolvedValueOnce(["0", ["1"]]);
    redisMock.pipeline.mockReturnValueOnce(badPipeline as any);
    await expect(store.listStuckExecutions()).resolves.toEqual([]);
  });
});
