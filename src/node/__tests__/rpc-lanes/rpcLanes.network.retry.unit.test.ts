import { Readable } from "stream";
import type { RpcLaneRetryPolicy } from "../../../defs";
import { RemoteLaneTransportError } from "../../../remote-lanes/http/protocol";
import { resolveRpcLaneRetryPolicy } from "../../../remote-lanes/retry";
import { Serializer } from "../../../serializer";
import { runtimeSource } from "../../../types/runtimeSource";
import { applyNetworkModeRouting } from "../../rpc-lanes/rpcLanes.network";
import { RPC_LANES_RESOURCE_ID } from "../../rpc-lanes/rpcLanes.resource";

function transportError(
  code: string,
  extras?: { httpCode?: number },
): RemoteLaneTransportError {
  return new RemoteLaneTransportError(code, `${code} failure`, undefined, {
    httpCode: extras?.httpCode,
  });
}

function taskRouting(options: {
  communicator: { task: jest.Mock };
  retry?: RpcLaneRetryPolicy;
}) {
  const lane = { id: "rpc-lanes-network-retry-task", policy: {} };
  const canonicalTaskId = "app.tasks.retry";
  const taskEntry = {
    task: {
      id: "retry",
      run: async (_input: unknown) => undefined,
    },
  };
  const context = {
    resolved: {
      taskLaneByTaskId: new Map([[canonicalTaskId, lane]]),
      eventLaneByEventId: new Map(),
      bindingsByLaneId: new Map([
        [
          lane.id,
          {
            lane,
            communicator: options.communicator,
            auth: undefined,
            asyncContextAllowList: undefined,
            retry: resolveRpcLaneRetryPolicy(options.retry),
          },
        ],
      ]),
      serveLaneIds: new Set<string>(),
    },
    dependencies: {
      store: {
        tasks: new Map([[canonicalTaskId, taskEntry]]),
        events: new Map(),
        asyncContexts: new Map(),
        findIdByDefinition: () => canonicalTaskId,
      },
      eventManager: { intercept: jest.fn() },
      serializer: new Serializer(),
    },
    resourceId: RPC_LANES_RESOURCE_ID,
  };

  applyNetworkModeRouting(context as never);
  return taskEntry.task.run as (
    input?: unknown,
    deps?: unknown,
    taskContext?: { signal?: AbortSignal },
  ) => Promise<unknown>;
}

function eventRouting(communicator: {
  event?: jest.Mock;
  eventWithResult?: jest.Mock;
}) {
  const intercept = jest.fn();
  const lane = { id: "rpc-lanes-network-retry-event" };
  const context = {
    resolved: {
      taskLaneByTaskId: new Map(),
      eventLaneByEventId: new Map([["retry-event", lane]]),
      bindingsByLaneId: new Map([
        [
          lane.id,
          {
            lane,
            communicator,
            auth: undefined,
            asyncContextAllowList: undefined,
            retry: resolveRpcLaneRetryPolicy({ delayMs: 0 }),
          },
        ],
      ]),
      serveLaneIds: new Set<string>(),
    },
    dependencies: {
      store: {
        events: new Map(),
        asyncContexts: new Map(),
      },
      eventManager: { intercept },
      serializer: new Serializer(),
    },
    resourceId: RPC_LANES_RESOURCE_ID,
  };

  applyNetworkModeRouting(context as never);
  return intercept.mock.calls[0][0] as (
    next: (emission: unknown) => Promise<void>,
    emission: {
      id: string;
      data: unknown;
      signal: AbortSignal;
      source: unknown;
    },
  ) => Promise<void>;
}

function testEmission(data: unknown) {
  return {
    id: "retry-event",
    data,
    signal: new AbortController().signal,
    source: runtimeSource.task("rpc-lanes-network-retry.source"),
  };
}

describe("rpc-lanes network retry", () => {
  it("retries task calls on retryable failures", async () => {
    const task = jest.fn(async () => {
      if (task.mock.calls.length < 3) {
        throw transportError("TIMEOUT");
      }
      return "recovered";
    });
    const run = taskRouting({ communicator: { task }, retry: { delayMs: 0 } });

    await expect(run({ a: 1 })).resolves.toBe("recovered");
    expect(task).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["octet-stream", () => Readable.from(["upload"])],
    [
      "multipart stream",
      () => ({
        file: {
          $runnerFile: "File",
          id: "upload",
          _node: { stream: Readable.from(["upload"]) },
        },
      }),
    ],
    [
      "multipart buffer",
      () => ({
        file: {
          $runnerFile: "File",
          id: "upload",
          _node: { buffer: Buffer.from("upload") },
        },
      }),
    ],
  ] as const)(
    "does not replay %s uploads after transport failure",
    async (_kind, input) => {
      const failure = transportError("NETWORK_ERROR");
      const communicator = {
        task: jest.fn(async function () {
          expect(this).toBe(communicator);
          throw failure;
        }),
      };
      const run = taskRouting({
        communicator,
        retry: { maxAttempts: 3, delayMs: 0 },
      });

      await expect(run(input())).rejects.toBe(failure);
      expect(communicator.task).toHaveBeenCalledTimes(1);
    },
  );

  it("gives up task calls after maxAttempts", async () => {
    const task = jest.fn(async () => {
      throw transportError("NETWORK_ERROR");
    });
    const run = taskRouting({
      communicator: { task },
      retry: { maxAttempts: 2, delayMs: 0 },
    });

    await expect(run({ a: 1 })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("does not retry task calls on definitive failures", async () => {
    const task = jest.fn(async () => {
      throw transportError("HTTP_ERROR", { httpCode: 500 });
    });
    const run = taskRouting({ communicator: { task } });

    await expect(run({ a: 1 })).rejects.toMatchObject({ httpCode: 500 });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("does not retry task calls when the caller signal aborted", async () => {
    const task = jest.fn(async () => {
      throw transportError("TIMEOUT");
    });
    const run = taskRouting({ communicator: { task }, retry: { delayMs: 0 } });
    const controller = new AbortController();
    controller.abort();

    await expect(
      run({ a: 1 }, undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("retries eventWithResult calls on retryable failures", async () => {
    const eventWithResult = jest.fn(async () => {
      if (eventWithResult.mock.calls.length < 2) {
        throw transportError("NETWORK_ERROR");
      }
      return { updated: true };
    });
    const intercept = eventRouting({ eventWithResult });
    const emission = testEmission({ hello: "world" });

    await intercept(jest.fn(), emission);

    expect(emission.data).toEqual({ updated: true });
    expect(eventWithResult).toHaveBeenCalledTimes(2);
  });

  it("retries fire-and-forget event calls on retryable failures", async () => {
    const event = jest.fn(async () => {
      if (event.mock.calls.length < 2) {
        throw transportError("NETWORK_ERROR");
      }
      return undefined;
    });
    const intercept = eventRouting({ event });

    await intercept(jest.fn(), testEmission({ hello: "world" }));

    expect(event).toHaveBeenCalledTimes(2);
  });
});
