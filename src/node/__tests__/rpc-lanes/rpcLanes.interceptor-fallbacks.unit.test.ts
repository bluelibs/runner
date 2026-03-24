import { Serializer } from "../../../serializer";
import { runtimeSource } from "../../../types/runtimeSource";
import * as laneAuth from "../../remote-lanes/laneAuth";
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
        signal: new AbortController().signal,
        source: runtimeSource.task("rpc-lanes-network-raw-id.source"),
      }),
    ).resolves.toBeUndefined();
    expect(communicator.event).toHaveBeenCalledWith(
      "raw-event",
      { value: 1 },
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("keeps local-simulated task execution working when allowlisted async context ids are missing", async () => {
    const serializer = new Serializer();
    const lane = {
      id: "rpc-lanes-local-simulated-missing-async-context",
      asyncContexts: ["missing-context-id"],
      policy: {},
    };
    const run = jest.fn(async (input: unknown) => input);
    const taskEntry = { task: { id: "app.tasks.echo", run } };
    const context = {
      config: {
        topology: {
          bindings: [{ lane }],
        },
      },
      resolved: {
        taskLaneByTaskId: new Map([[taskEntry.task.id, lane]]),
        eventLaneByEventId: new Map(),
      },
      dependencies: {
        store: {
          tasks: new Map([[taskEntry.task.id, taskEntry]]),
          events: new Map(),
          asyncContexts: new Map(),
        },
        eventManager: { intercept: jest.fn() },
        serializer,
      },
      resourceId: RPC_LANES_RESOURCE_ID,
    };

    applyLocalSimulatedModeRouting(context as any);
    const result = await taskEntry.task.run({ value: 1 });

    expect(result).toEqual({ value: 1 });
    expect(run).toHaveBeenCalledWith({ value: 1 }, undefined, undefined);
  });

  it("issues and verifies bound lane tokens for local-simulated task routing", async () => {
    const serializer = new Serializer();
    const lane = {
      id: "rpc-lanes-local-simulated-auth-task",
      policy: {},
    };
    const run = jest.fn(async (input: unknown) => input);
    const canonicalTaskId = "app.tasks.secured";
    const taskEntry = { task: { id: "secured", run } };
    const issueSpy = jest.spyOn(laneAuth, "issueRemoteLaneToken");
    const verifySpy = jest.spyOn(laneAuth, "verifyRemoteLaneToken");
    const context = {
      config: {
        topology: {
          bindings: [{ lane, auth: { secret: "task-secret" } }],
        },
      },
      resolved: {
        taskLaneByTaskId: new Map([[canonicalTaskId, lane]]),
        eventLaneByEventId: new Map(),
      },
      dependencies: {
        store: {
          tasks: new Map([[canonicalTaskId, taskEntry]]),
          events: new Map(),
          asyncContexts: new Map(),
        },
        eventManager: { intercept: jest.fn() },
        serializer,
      },
      resourceId: RPC_LANES_RESOURCE_ID,
    };

    applyLocalSimulatedModeRouting(context as any);
    await taskEntry.task.run({ value: 1 });

    const expectedPayloadText = serializer.stringify({ input: { value: 1 } });
    expect(issueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        laneId: lane.id,
        bindingAuth: { secret: "task-secret" },
        capability: "produce",
        target: {
          kind: "rpc-task",
          targetId: canonicalTaskId,
          payloadHash: laneAuth.hashRemoteLanePayload(expectedPayloadText),
        },
      }),
    );
    expect(verifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        laneId: lane.id,
        bindingAuth: { secret: "task-secret" },
        requiredCapability: "produce",
        expectedTarget: {
          kind: "rpc-task",
          targetId: canonicalTaskId,
          payloadHash: laneAuth.hashRemoteLanePayload(expectedPayloadText),
        },
      }),
    );
  });

  it("issues and verifies bound lane tokens for local-simulated event routing", async () => {
    const intercept = jest.fn();
    const serializer = new Serializer();
    const lane = { id: "rpc-lanes-local-simulated-auth-event" };
    const issueSpy = jest.spyOn(laneAuth, "issueRemoteLaneToken");
    const verifySpy = jest.spyOn(laneAuth, "verifyRemoteLaneToken");
    const context = {
      config: {
        topology: {
          bindings: [{ lane, auth: { secret: "event-secret" } }],
        },
      },
      resolved: {
        taskLaneByTaskId: new Map(),
        eventLaneByEventId: new Map([["app.events.changed", lane]]),
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
    });
    const emission = {
      id: "app.events.changed",
      data: { value: 1 },
      source: runtimeSource.task("rpc-lanes-local-simulated-auth-event.source"),
    };

    await interceptor(next, emission);

    const expectedPayloadText = serializer.stringify({
      payload: { value: 1 },
    });
    expect(issueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        laneId: lane.id,
        bindingAuth: { secret: "event-secret" },
        capability: "produce",
        target: {
          kind: "rpc-event",
          targetId: emission.id,
          payloadHash: laneAuth.hashRemoteLanePayload(expectedPayloadText),
        },
      }),
    );
    expect(verifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        laneId: lane.id,
        bindingAuth: { secret: "event-secret" },
        requiredCapability: "produce",
        expectedTarget: {
          kind: "rpc-event",
          targetId: emission.id,
          payloadHash: laneAuth.hashRemoteLanePayload(expectedPayloadText),
        },
      }),
    );
  });
});
