import * as http from "http";
import type { RpcLaneRequestOptions } from "../../../defs";
import { defineEvent, defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalResources } from "../../../globals/globalResources";
import { globalTags } from "../../../globals/globalTags";
import { rpcLanesResource } from "../../rpc-lanes";
import { r } from "../../../public";
import { issueRemoteLaneToken } from "../../remote-lanes/laneAuth";
import { runtimeSource } from "../../../types/runtimeSource";

describe("rpcLanes auth", () => {
  it("enforces lane auth in local-simulated mode", async () => {
    const lane = r.rpcLane("tests.rpc-lanes.auth.local-simulated.lane").build();
    const task = defineTask<{ value: number }>({
      id: "tests.rpc-lanes.auth.local-simulated.task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async (input) => input.value + 1,
    });
    const communicator = defineResource({
      id: "tests.rpc-lanes.auth.local-simulated.communicator",
      init: async () => ({
        task: async () => 1,
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator, auth: { secret: "simulated-secret" } }],
    });

    const app = defineResource({
      id: "tests.rpc-lanes.auth.local-simulated.app",
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
      .rpcLane("tests.rpc-lanes.auth.local-simulated.missing.lane")
      .build();
    const task = defineTask({
      id: "tests.rpc-lanes.auth.local-simulated.missing.task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "ok",
    });
    const communicator = defineResource({
      id: "tests.rpc-lanes.auth.local-simulated.missing.communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator, auth: {} }],
    });
    const app = defineResource({
      id: "tests.rpc-lanes.auth.local-simulated.missing.app",
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
      name: "runner.errors.remoteLanes.auth.signerMissing",
    });
  });

  it("enforces served-lane JWT in network exposure", async () => {
    const lane = r.rpcLane("tests.rpc-lanes.auth.network.lane").build();
    const event = defineEvent<{ value: number }>({
      id: "tests.rpc-lanes.auth.network.event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    let eventRuns = 0;
    const hook = r
      .hook("tests.rpc-lanes.auth.network.event.hook")
      .on(event)
      .run(async () => {
        eventRuns += 1;
      })
      .build();
    const task = defineTask({
      id: "tests.rpc-lanes.auth.network.task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "secured",
    });
    const communicator = defineResource({
      id: "tests.rpc-lanes.auth.network.communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        server: { serve: [lane] },
      },
      bindings: [{ lane, communicator, auth: { secret: "network-secret" } }],
    });
    const server = http.createServer();
    const lanes = rpcLanesResource.with({
      profile: "server",
      topology,
      mode: "network",
      exposure: {
        http: {
          server,
          basePath: "/__runner",
          dangerouslyAllowOpenExposure: true,
          auth: { allowAnonymous: true },
        },
      },
    });
    const app = defineResource({
      id: "tests.rpc-lanes.auth.network.app",
      register: [event, hook, task, communicator, lanes],
    });

    const runtime = await run(app);
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.listen(0, "127.0.0.1", onListening);
      });

      const address = server.address();
      expect(address).toBeTruthy();
      expect(typeof address).toBe("object");
      const tcpAddress = address as { port: number };

      const url = `http://127.0.0.1:${tcpAddress.port}/__runner/task/${encodeURIComponent(task.id)}`;

      const unauthorized = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: {} }),
      });
      const unauthorizedJson = await unauthorized.json();
      expect(unauthorized.status).toBe(401);
      expect(unauthorizedJson.error.code).toBe("UNAUTHORIZED");

      const token = issueRemoteLaneToken({
        laneId: lane.id,
        bindingAuth: topology.bindings[0]?.auth,
        capability: "produce",
      });
      const authToken = token as string;

      const authorized = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ input: {} }),
      });
      const authorizedJson = await authorized.json();
      expect(authorized.status).toBe(200);
      expect(authorizedJson.result).toBe("secured");

      const eventUrl = `http://127.0.0.1:${tcpAddress.port}/__runner/event/${encodeURIComponent(event.id)}`;
      const unauthorizedEvent = await fetch(eventUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { value: 1 } }),
      });
      expect(unauthorizedEvent.status).toBe(401);

      const authorizedEvent = await fetch(eventUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ payload: { value: 1 } }),
      });
      expect(authorizedEvent.status).toBe(200);
      expect(eventRuns).toBe(1);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }
      throw error;
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
      await runtime.dispose();
    }
  });

  it("forwards lane JWT headers for network outbound task/event communicator calls", async () => {
    const lane = r.rpcLane("tests.rpc-lanes.auth.network.forward.lane").build();
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
      id: "tests.rpc-lanes.auth.network.forward.event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const task = defineTask({
      id: "tests.rpc-lanes.auth.network.forward.task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const emitTask = defineTask({
      id: "tests.rpc-lanes.auth.network.forward.emit-task",
      dependencies: { eventManager: globalResources.eventManager },
      run: async (_input, deps) =>
        deps.eventManager.emit(
          event,
          { value: 1 },
          runtimeSource.task("tests.rpc-lanes.auth.network.forward.emit-task"),
        ),
    });
    const communicator = defineResource({
      id: "tests.rpc-lanes.auth.network.forward.communicator",
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
      id: "tests.rpc-lanes.auth.network.forward.app",
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

    const taskOptions = remoteTask.mock.calls[0]?.[2];
    const eventOptions = remoteEvent.mock.calls[0]?.[2];
    expect(taskOptions?.headers?.authorization).toMatch(/^Bearer /);
    expect(eventOptions?.headers?.authorization).toMatch(/^Bearer /);
    await runtime.dispose();
  });

  it("forwards lane JWT headers for network eventWithResult communicator calls", async () => {
    const lane = r
      .rpcLane("tests.rpc-lanes.auth.network.forward-result.lane")
      .build();
    const event = defineEvent<{ value: number }>({
      id: "tests.rpc-lanes.auth.network.forward-result.event",
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
      id: "tests.rpc-lanes.auth.network.forward-result.emit-task",
      dependencies: { eventManager: globalResources.eventManager },
      run: async (_input, deps) =>
        deps.eventManager.emitWithResult(
          event,
          { value: 1 },
          runtimeSource.task(
            "tests.rpc-lanes.auth.network.forward-result.emit-task",
          ),
        ),
    });
    const communicator = defineResource({
      id: "tests.rpc-lanes.auth.network.forward-result.communicator",
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
      id: "tests.rpc-lanes.auth.network.forward-result.app",
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
    const options = remoteEventWithResult.mock.calls[0]?.[2];
    expect(options?.headers?.authorization).toMatch(/^Bearer /);
    await runtime.dispose();
  });

  it("enforces lane auth in local-simulated event flow", async () => {
    const lane = r
      .rpcLane("tests.rpc-lanes.auth.local-simulated.event.lane")
      .build();
    const event = defineEvent<{ value: number }>({
      id: "tests.rpc-lanes.auth.local-simulated.event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const hook = r
      .hook("tests.rpc-lanes.auth.local-simulated.event.hook")
      .on(event)
      .run(async (emission) => {
        emission.data.value += 1;
      })
      .build();
    const emitTask = defineTask({
      id: "tests.rpc-lanes.auth.local-simulated.event.emit-task",
      dependencies: { eventManager: globalResources.eventManager },
      run: async (_input, deps) =>
        deps.eventManager.emitWithResult(
          event,
          { value: 1 },
          runtimeSource.task(
            "tests.rpc-lanes.auth.local-simulated.event.emit-task",
          ),
        ),
    });
    const communicator = defineResource({
      id: "tests.rpc-lanes.auth.local-simulated.event.communicator",
      init: async () => ({ event: async () => undefined }),
    });
    const topology = r.rpcLane.topology({
      profiles: { client: { serve: [] } },
      bindings: [{ lane, communicator, auth: { secret: "sim-event-secret" } }],
    });
    const app = defineResource({
      id: "tests.rpc-lanes.auth.local-simulated.event.app",
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
