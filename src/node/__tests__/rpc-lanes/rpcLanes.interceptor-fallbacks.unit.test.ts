import { Serializer } from "../../../serializer";
import { runtimeSource } from "../../../types/runtimeSource";
import { applyLocalSimulatedModeRouting } from "../../rpc-lanes/rpcLanes.local-simulated";
import { applyNetworkModeRouting } from "../../rpc-lanes/rpcLanes.network";
import { RPC_LANES_RESOURCE_ID } from "../../rpc-lanes/rpcLanes.resource";

describe("rpc-lanes interceptor fallback branches", () => {
  it("routes local-simulated events by raw emission ids when store lookup misses", async () => {
    const intercept = jest.fn();
    const serializer = new Serializer();
    const lane = { id: "rpc-lanes-local-simulated-raw-id" };
    const context = {
      config: {
        topology: {
          bindings: [{ lane }],
        },
      },
      resolved: {
        taskLaneByTaskId: new Map(),
        eventLaneByEventId: new Map([["raw-event", lane]]),
      },
      dependencies: {
        store: {
          events: new Map(),
          asyncContexts: new Map(),
        },
        eventManager: { intercept },
        serializer,
      },
      resourceId: RPC_LANES_RESOURCE_ID,
    };

    applyLocalSimulatedModeRouting(context as any);
    const interceptor = intercept.mock.calls[0][0];
    const next = jest.fn(async (emission) => {
      emission.data.value += 1;
      return "next-result";
    });
    const emission = {
      id: "raw-event",
      data: { value: 1 },
      source: runtimeSource.task("rpc-lanes-local-simulated-raw-id.source"),
    };

    await expect(interceptor(next, emission)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(emission.data).toEqual({ value: 2 });
  });

  it("routes network-mode events by raw emission ids when store lookup misses", async () => {
    const intercept = jest.fn();
    const communicator = {
      event: jest.fn(async () => undefined),
    };
    const lane = { id: "rpc-lanes-network-raw-id", policy: {} };
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
          toPublicId: (id: string) => id,
        },
        eventManager: { intercept },
        serializer: new Serializer(),
      },
      resourceId: RPC_LANES_RESOURCE_ID,
    };

    applyNetworkModeRouting(context as any);
    const interceptor = intercept.mock.calls[0][0];
    const next = jest.fn(async () => "next-result");

    await expect(
      interceptor(next, {
        id: "raw-event",
        data: { value: 1 },
        source: runtimeSource.task("rpc-lanes-network-raw-id.source"),
      }),
    ).resolves.toBeUndefined();
    expect(communicator.event).toHaveBeenCalledWith("raw-event", { value: 1 });
    expect(next).not.toHaveBeenCalled();
  });
});
