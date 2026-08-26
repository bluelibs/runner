import { Readable } from "stream";
import { Serializer } from "../../../serializer";
import { runtimeSource } from "../../../types/runtimeSource";
import * as laneAuth from "../../remote-lanes/laneAuth";
import { applyNetworkModeRouting } from "../../rpc-lanes/rpcLanes.network";
import { RPC_LANES_RESOURCE_ID } from "../../rpc-lanes/rpcLanes.resource";

function pipeableBody() {
  return Readable.from(["chunk"]);
}

describe("rpc-lanes network re-encoded bodies", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("hashes an empty body for Readable task input", async () => {
    const communicator = {
      task: jest.fn(async () => "ok"),
    };
    const lane = { id: "rpc-lanes-network-readable-task", policy: {} };
    const canonicalTaskId = "app.tasks.stream";
    const taskEntry = {
      task: {
        id: "stream",
        run: async (_input: unknown) => undefined,
      },
    };
    const issueSpy = jest.spyOn(laneAuth, "issueRemoteLaneToken");
    const context = {
      resolved: {
        taskLaneByTaskId: new Map([[canonicalTaskId, lane]]),
        eventLaneByEventId: new Map(),
        bindingsByLaneId: new Map([
          [
            lane.id,
            {
              lane,
              communicator,
              auth: { secret: "stream-secret" },
              asyncContextAllowList: undefined,
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
    await taskEntry.task.run(pipeableBody());

    expect(issueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({
          payloadHash: laneAuth.hashRemoteLanePayload(""),
        }),
      }),
    );
    expect(communicator.task).toHaveBeenCalledTimes(1);
  });

  it("hashes an empty body for Readable eventWithResult payloads", async () => {
    const intercept = jest.fn();
    const communicator = {
      eventWithResult: jest.fn(async () => undefined),
    };
    const lane = { id: "rpc-lanes-network-readable-event-result" };
    const issueSpy = jest.spyOn(laneAuth, "issueRemoteLaneToken");
    const context = {
      resolved: {
        taskLaneByTaskId: new Map(),
        eventLaneByEventId: new Map([["raw-event", lane]]),
        bindingsByLaneId: new Map([
          [
            lane.id,
            {
              lane,
              communicator,
              auth: { secret: "stream-secret" },
              asyncContextAllowList: undefined,
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
    const interceptor = intercept.mock.calls[0][0];
    await interceptor(jest.fn(), {
      id: "raw-event",
      data: pipeableBody(),
      signal: new AbortController().signal,
      source: runtimeSource.task("rpc-lanes-network-readable-event.source"),
    });

    expect(issueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({
          payloadHash: laneAuth.hashRemoteLanePayload(""),
        }),
      }),
    );
    expect(communicator.eventWithResult).toHaveBeenCalledTimes(1);
  });

  it("hashes an empty body for Readable fire-and-forget event payloads", async () => {
    const intercept = jest.fn();
    const communicator = {
      event: jest.fn(async () => undefined),
    };
    const lane = { id: "rpc-lanes-network-readable-event" };
    const issueSpy = jest.spyOn(laneAuth, "issueRemoteLaneToken");
    const context = {
      resolved: {
        taskLaneByTaskId: new Map(),
        eventLaneByEventId: new Map([["raw-event", lane]]),
        bindingsByLaneId: new Map([
          [
            lane.id,
            {
              lane,
              communicator,
              auth: { secret: "stream-secret" },
              asyncContextAllowList: undefined,
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
    const interceptor = intercept.mock.calls[0][0];
    await interceptor(jest.fn(), {
      id: "raw-event",
      data: pipeableBody(),
      signal: new AbortController().signal,
      source: runtimeSource.task(
        "rpc-lanes-network-readable-event-fire.source",
      ),
    });

    expect(issueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({
          payloadHash: laneAuth.hashRemoteLanePayload(""),
        }),
      }),
    );
    expect(communicator.event).toHaveBeenCalledTimes(1);
  });
});
