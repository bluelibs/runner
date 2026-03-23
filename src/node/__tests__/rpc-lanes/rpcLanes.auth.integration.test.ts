import * as http from "http";
import type { RpcLaneRequestOptions } from "../../../defs";
import { defineEvent, defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalResources } from "../../../globals/globalResources";
import { globalTags } from "../../../globals/globalTags";
import { rpcLanesResource } from "../../rpc-lanes";
import { r } from "../../../public";
import {
  hashRemoteLanePayload,
  verifyRemoteLaneToken,
} from "../../remote-lanes/laneAuth";
import { buildRpcLaneAuthHeaders } from "../../rpc-lanes/rpcLanes.auth";
import { runtimeSource } from "../../../types/runtimeSource";
import { genericError } from "../../../errors";
import { Serializer } from "../../../serializer";
import {
  createClientRpcLaneTopology,
  createMockRpcLaneCommunicator,
  createServerRpcLaneTopology,
} from "./test.utils";

describe("rpcLanes auth", () => {
  const allocatePort = async (): Promise<number> => {
    const probe = http.createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", resolve);
    });
    const address = probe.address();
    if (!address || typeof address === "string") {
      throw genericError.new({ message: "Could not allocate test port." });
    }
    await new Promise<void>((resolve, reject) => {
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    return address.port;
  };

  it("enforces lane auth in local-simulated mode", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-auth-local-simulated-lane").build();
    const task = defineTask<{ value: number }>({
      id: "tests-rpc-lanes-auth-local-simulated-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async (input) => input.value + 1,
    });
    const communicator = createMockRpcLaneCommunicator(
      "tests-rpc-lanes-auth-local-simulated-communicator",
      { task: async () => 1 },
    );
    const topology = createClientRpcLaneTopology([
      { lane, communicator, auth: { secret: "simulated-secret" } },
    ]);

    const app = defineResource({
      id: "tests-rpc-lanes-auth-local-simulated-app",
      register: [
        task,
        rpcLanesResource.with({
          profile: "client",
          topology,
          mode: "local-simulated",
        }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task as any, { value: 4 })).resolves.toBe(5);
    await runtime.dispose();
  });

  it("fails fast in local-simulated mode when signer material is missing", async () => {
    const lane = r
      .rpcLane("tests-rpc-lanes-auth-local-simulated-missing-lane")
      .build();
    const task = defineTask({
      id: "tests-rpc-lanes-auth-local-simulated-missing-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "ok",
    });
    const communicator = createMockRpcLaneCommunicator(
      "tests-rpc-lanes-auth-local-simulated-missing-communicator",
    );
    const topology = createClientRpcLaneTopology([
      { lane, communicator, auth: {} },
    ]);
    const app = defineResource({
      id: "tests-rpc-lanes-auth-local-simulated-missing-app",
      register: [
        task,
        rpcLanesResource.with({
          profile: "client",
          topology,
          mode: "local-simulated",
        }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "remoteLanes-auth-signerMissing",
    });
  });

  it("fails fast in local-simulated mode when verifier material is missing", async () => {
    const lane = r
      .rpcLane("tests-rpc-lanes-auth-local-simulated-verifier-missing-lane")
      .build();
    const task = defineTask({
      id: "tests-rpc-lanes-auth-local-simulated-verifier-missing-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "ok",
    });
    const communicator = createMockRpcLaneCommunicator(
      "tests-rpc-lanes-auth-local-simulated-verifier-missing-communicator",
    );
    const topology = createClientRpcLaneTopology([
      {
        lane,
        communicator,
        auth: { produceSecret: "produce-only-secret" },
      },
    ]);
    const app = defineResource({
      id: "tests-rpc-lanes-auth-local-simulated-verifier-missing-app",
      register: [
        task,
        rpcLanesResource.with({
          profile: "client",
          topology,
          mode: "local-simulated",
        }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "remoteLanes-auth-verifierMissing",
    });
  });

  it("enforces served-lane JWT in network exposure", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-auth-network-lane").build();
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-auth-network-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    let eventRuns = 0;
    const hook = r
      .hook("tests-rpc-lanes-auth-network-event-hook")
      .on(event)
      .run(async () => {
        eventRuns += 1;
      })
      .build();
    const task = defineTask({
      id: "tests-rpc-lanes-auth-network-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "secured",
    });
    const communicator = createMockRpcLaneCommunicator(
      "tests-rpc-lanes-auth-network-communicator",
    );
    const topology = createServerRpcLaneTopology(
      [lane],
      [{ lane, communicator, auth: { secret: "network-secret" } }],
    );
    const exposurePort = await allocatePort();
    const lanes = rpcLanesResource.with({
      profile: "server",
      topology,
      mode: "network",
      exposure: {
        http: {
          listen: { port: exposurePort, host: "127.0.0.1" },
          basePath: "/__runner",
          auth: { allowAnonymous: true },
        },
      },
    });
    const app = defineResource({
      id: "tests-rpc-lanes-auth-network-app",
      register: [event, hook, task, communicator, lanes],
    });

    const runtime = await run(app);
    try {
      const serializer = new Serializer();
      const discoveryUrl = `http://127.0.0.1:${exposurePort}/__runner/discovery`;
      const discovery = await fetch(discoveryUrl);
      const discoveryJson = await discovery.json();
      const servedTaskId = discoveryJson.result.allowList.tasks[0] as string;
      const servedEventId = discoveryJson.result.allowList.events[0] as string;
      const taskBody = serializer.stringify({ input: {} });
      const mismatchedTaskBody = serializer.stringify({ input: { value: 9 } });
      const eventBody = serializer.stringify({ payload: { value: 1 } });

      const url = `http://127.0.0.1:${exposurePort}/__runner/task/${encodeURIComponent(servedTaskId)}`;

      const unauthorized = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: taskBody,
      });
      const unauthorizedJson = await unauthorized.json();
      expect(unauthorized.status).toBe(401);
      expect(unauthorizedJson.error.code).toBe("UNAUTHORIZED");

      const taskHeaders = buildRpcLaneAuthHeaders({
        lane,
        bindingAuth: topology.bindings[0]?.auth,
        target: {
          kind: "rpc-task",
          targetId: servedTaskId,
          payloadHash: hashRemoteLanePayload(taskBody),
        },
      })!;

      const mismatchedTaskHeaders = buildRpcLaneAuthHeaders({
        lane,
        bindingAuth: topology.bindings[0]?.auth,
        target: {
          kind: "rpc-task",
          targetId: servedTaskId,
          payloadHash: hashRemoteLanePayload(taskBody),
        },
      })!;

      const authorized = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...taskHeaders,
        },
        body: taskBody,
      });
      const authorizedJson = await authorized.json();
      expect(authorized.status).toBe(200);
      expect(authorizedJson.result).toBe("secured");

      const mismatchedTask = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...mismatchedTaskHeaders,
        },
        body: mismatchedTaskBody,
      });
      expect(mismatchedTask.status).toBe(401);

      const eventUrl = `http://127.0.0.1:${exposurePort}/__runner/event/${encodeURIComponent(servedEventId)}`;
      const unauthorizedEvent = await fetch(eventUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: eventBody,
      });
      expect(unauthorizedEvent.status).toBe(401);

      const eventHeaders = buildRpcLaneAuthHeaders({
        lane,
        bindingAuth: topology.bindings[0]?.auth,
        target: {
          kind: "rpc-event",
          targetId: servedEventId,
          payloadHash: hashRemoteLanePayload(eventBody),
        },
      })!;

      const authorizedEvent = await fetch(eventUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...eventHeaders,
        },
        body: eventBody,
      });
      expect(authorizedEvent.status).toBe(200);
      expect(eventRuns).toBe(1);

      const wrongTargetEvent = await fetch(eventUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...taskHeaders,
        },
        body: eventBody,
      });
      expect(wrongTargetEvent.status).toBe(401);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }
      throw error;
    } finally {
      await runtime.dispose();
    }
  });

  it("forwards lane JWT headers for network outbound task/event communicator calls", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-auth-network-forward-lane").build();
    const remoteTask = jest.fn(
      async (_id: string, _input?: unknown, _options?: RpcLaneRequestOptions) =>
        "remote-ok",
    );
    const remoteEvent = jest.fn(
      async (
        _id: string,
        _payload?: unknown,
        _options?: RpcLaneRequestOptions,
      ) => undefined,
    );
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-auth-network-forward-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const task = defineTask({
      id: "tests-rpc-lanes-auth-network-forward-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const emitTask = defineTask({
      id: "tests-rpc-lanes-auth-network-forward-emit-task",
      dependencies: { eventManager: globalResources.eventManager },
      run: async (_input, deps) =>
        deps.eventManager.emit(
          event,
          { value: 1 },
          runtimeSource.task("tests-rpc-lanes-auth-network-forward-emit-task"),
        ),
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-auth-network-forward-communicator",
      init: async () => ({
        task: remoteTask,
        event: remoteEvent,
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: { client: { serve: [] } },
      bindings: [{ lane, communicator, auth: { secret: "forward-secret" } }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-auth-network-forward-app",
      register: [
        task,
        event,
        emitTask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology, mode: "network" }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task as any)).resolves.toBe("remote-ok");
    await runtime.runTask(emitTask as any);

    const remoteTaskId = remoteTask.mock.calls[0]?.[0] as string;
    const remoteEventId = remoteEvent.mock.calls[0]?.[0] as string;
    const taskOptions = remoteTask.mock.calls[0]?.[2];
    const eventOptions = remoteEvent.mock.calls[0]?.[2];
    expect(taskOptions?.headers?.authorization).toMatch(/^Bearer /);
    expect(eventOptions?.headers?.authorization).toMatch(/^Bearer /);
    const taskToken = taskOptions?.headers?.authorization?.replace(
      /^Bearer\s+/,
      "",
    );
    const eventToken = eventOptions?.headers?.authorization?.replace(
      /^Bearer\s+/,
      "",
    );
    const serializer = new Serializer();

    expect(() =>
      verifyRemoteLaneToken({
        laneId: lane.id,
        bindingAuth: topology.bindings[0]?.auth,
        token: taskToken!,
        requiredCapability: "produce",
        expectedTarget: {
          kind: "rpc-task",
          targetId: remoteTaskId,
          payloadHash: hashRemoteLanePayload(
            serializer.stringify({ input: undefined }),
          ),
        },
      }),
    ).not.toThrow();
    expect(() =>
      verifyRemoteLaneToken({
        laneId: lane.id,
        bindingAuth: topology.bindings[0]?.auth,
        token: eventToken!,
        requiredCapability: "produce",
        expectedTarget: {
          kind: "rpc-event",
          targetId: remoteEventId,
          payloadHash: hashRemoteLanePayload(
            serializer.stringify({ payload: { value: 1 } }),
          ),
        },
      }),
    ).not.toThrow();
    await runtime.dispose();
  });

  it("forwards lane JWT headers for network eventWithResult communicator calls", async () => {
    const lane = r
      .rpcLane("tests-rpc-lanes-auth-network-forward-result-lane")
      .build();
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-auth-network-forward-result-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const remoteEventWithResult = jest.fn(
      async (
        _id: string,
        payload?: { value: number },
        _options?: RpcLaneRequestOptions,
      ) => ({
        value: (payload?.value ?? 0) + 10,
      }),
    );
    const emitTask = defineTask({
      id: "tests-rpc-lanes-auth-network-forward-result-emit-task",
      dependencies: { eventManager: globalResources.eventManager },
      run: async (_input, deps) =>
        deps.eventManager.emitWithResult(
          event,
          { value: 1 },
          runtimeSource.task(
            "tests-rpc-lanes-auth-network-forward-result-emit-task",
          ),
        ),
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-auth-network-forward-result-communicator",
      init: async () => ({
        eventWithResult: remoteEventWithResult,
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: { client: { serve: [] } },
      bindings: [
        { lane, communicator, auth: { secret: "forward-result-secret" } },
      ],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-auth-network-forward-result-app",
      register: [
        event,
        emitTask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology, mode: "network" }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(emitTask as any)).resolves.toEqual({
      value: 11,
    });
    const remoteEventId = remoteEventWithResult.mock.calls[0]?.[0] as string;
    const options = remoteEventWithResult.mock.calls[0]?.[2];
    expect(options?.headers?.authorization).toMatch(/^Bearer /);
    const token = options?.headers?.authorization?.replace(/^Bearer\s+/, "");
    const serializer = new Serializer();
    expect(() =>
      verifyRemoteLaneToken({
        laneId: lane.id,
        bindingAuth: topology.bindings[0]?.auth,
        token: token!,
        requiredCapability: "produce",
        expectedTarget: {
          kind: "rpc-event",
          targetId: remoteEventId,
          payloadHash: hashRemoteLanePayload(
            serializer.stringify({ payload: { value: 1 } }),
          ),
        },
      }),
    ).not.toThrow();
    await runtime.dispose();
  });

  it("enforces lane auth in local-simulated event flow", async () => {
    const lane = r
      .rpcLane("tests-rpc-lanes-auth-local-simulated-event-lane")
      .build();
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-auth-local-simulated-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const hook = r
      .hook("tests-rpc-lanes-auth-local-simulated-event-hook")
      .on(event)
      .run(async (emission) => {
        emission.data.value += 1;
      })
      .build();
    const emitTask = defineTask({
      id: "tests-rpc-lanes-auth-local-simulated-event-emit-task",
      dependencies: { eventManager: globalResources.eventManager },
      run: async (_input, deps) =>
        deps.eventManager.emitWithResult(
          event,
          { value: 1 },
          runtimeSource.task(
            "tests-rpc-lanes-auth-local-simulated-event-emit-task",
          ),
        ),
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-auth-local-simulated-event-communicator",
      init: async () => ({ event: async () => undefined }),
    });
    const topology = r.rpcLane.topology({
      profiles: { client: { serve: [] } },
      bindings: [{ lane, communicator, auth: { secret: "sim-event-secret" } }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-auth-local-simulated-event-app",
      register: [
        event,
        hook,
        emitTask,
        communicator,
        rpcLanesResource.with({
          profile: "client",
          topology,
          mode: "local-simulated",
        }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(emitTask as any)).resolves.toEqual({
      value: 2,
    });
    await runtime.dispose();
  });
});
