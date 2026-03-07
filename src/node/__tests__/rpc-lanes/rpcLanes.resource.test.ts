import type { RpcLaneRequestOptions } from "../../../defs";
import { defineEvent, defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalResources } from "../../../globals/globalResources";
import { globalTags } from "../../../globals/globalTags";
import { rpcLanesResource } from "../../rpc-lanes";
import { r } from "../../../public";
import { symbolRpcLaneRoutedBy } from "../../../types/symbols";
import { runtimeSource } from "../../../types/runtimeSource";
import * as exposureModule from "../../exposure/createNodeExposure";
import * as exposureLoggingModule from "../../exposure/logging";

describe("rpcLanesResource", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("routes tagged tasks remotely when lane is not served by active profile", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-remote-task-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-remote-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-remote-task-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-remote-task-app",
      register: [
        task,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const rr = await run(app);
    await expect(rr.runTask(task as any)).resolves.toBe("remote");
    await rr.dispose();
  });

  it("forwards only lane-allowlisted async contexts on remote RPC task calls", async () => {
    const allowedContext = r
      .asyncContext<{ value: string }>("tests-rpc-lanes-ctx-allowed")
      .build();
    const blockedContext = r
      .asyncContext<{ value: string }>("tests-rpc-lanes-ctx-blocked")
      .build();
    const lane = r
      .rpcLane("tests-rpc-lanes-remote-task-allowlisted-contexts")
      .asyncContexts([allowedContext.id])
      .build();
    const task = defineTask({
      id: "tests-rpc-lanes-remote-task-allowlisted-contexts-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const remoteTask = jest.fn(
      async (_id: string, _input?: unknown, _options?: RpcLaneRequestOptions) =>
        "remote",
    );
    const communicator = defineResource({
      id: "tests-rpc-lanes-remote-task-allowlisted-contexts-communicator",
      init: async () => ({
        task: remoteTask,
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-remote-task-allowlisted-contexts-app",
      register: [
        allowedContext,
        blockedContext,
        task,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const rr = await run(app);
    const serializer = await rr.getResourceValue(
      globalResources.serializer as any,
    );

    await allowedContext.provide({ value: "A" }, async () => {
      await blockedContext.provide({ value: "B" }, async () => {
        await expect(rr.runTask(task as any)).resolves.toBe("remote");
      });
    });

    const options = remoteTask.mock.calls[0]?.[2];
    const contextHeader = options?.headers?.["x-runner-context"] ?? "";
    const headerMap = serializer.parse(contextHeader) as Record<string, string>;
    expect(headerMap[allowedContext.id]).toBe(
      allowedContext.serialize({ value: "A" }),
    );
    expect(headerMap[blockedContext.id]).toBeUndefined();
    await rr.dispose();
  });

  it("keeps local execution when lane is served by active profile", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-local-task-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-local-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-local-task-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [lane] },
      },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-local-task-app",
      register: [
        task,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const rr = await run(app);
    await expect(rr.runTask(task as any)).resolves.toBe("local");
    await rr.dispose();
  });

  it("fails when a tagged task lane has no communicator binding", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-unbound-task-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-unbound-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [],
    } as any);
    const app = defineResource({
      id: "tests-rpc-lanes-unbound-task-app",
      register: [task, rpcLanesResource.with({ profile: "client", topology })],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "runner.errors.rpcLane.bindingNotFound",
    });
  });

  it("ignores non-rpc-lane tasks while applying rpc lane routing", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-only-tagged-lane").build();
    const taggedTask = defineTask({
      id: "tests-rpc-lanes-only-tagged-tagged",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local-tagged",
    });
    const plainTask = defineTask({
      id: "tests-rpc-lanes-only-tagged-plain",
      run: async () => "local-plain",
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-only-tagged-communicator",
      init: async () => ({
        task: async () => "remote-tagged",
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-only-tagged-app",
      register: [
        taggedTask,
        plainTask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const rr = await run(app);
    await expect(rr.runTask(taggedTask as any)).resolves.toBe("remote-tagged");
    await expect(rr.runTask(plainTask as any)).resolves.toBe("local-plain");
    await rr.dispose();
  });

  it("routes tagged events remotely when lane is not served by active profile", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-remote-event-lane").build();
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-remote-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const eventCapture = jest.fn(async () => undefined);
    const communicator = defineResource({
      id: "tests-rpc-lanes-remote-event-communicator",
      init: async () => ({
        event: eventCapture,
      }),
    });

    let localHookRuns = 0;
    const localHook = r
      .hook("tests-rpc-lanes-remote-event-local-hook")
      .on(event)
      .run(async () => {
        localHookRuns += 1;
      })
      .build();

    const emitTask = defineTask({
      id: "tests-rpc-lanes-remote-event-emit-task",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) => {
        await deps.eventManager.emit(
          event,
          { value: 1 },
          runtimeSource.task("tests-rpc-lanes-remote-event-emit-task"),
        );
      },
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-remote-event-app",
      register: [
        event,
        localHook,
        emitTask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const rr = await run(app);
    await rr.runTask(emitTask as any);
    expect(eventCapture).toHaveBeenCalledWith(event.id, { value: 1 });
    expect(localHookRuns).toBe(0);
    await rr.dispose();
  });

  it("keeps local event emission when lane is served by active profile", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-local-event-lane").build();
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-local-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const eventCapture = jest.fn(async () => undefined);
    const communicator = defineResource({
      id: "tests-rpc-lanes-local-event-communicator",
      init: async () => ({
        event: eventCapture,
      }),
    });

    let localHookRuns = 0;
    const localHook = r
      .hook("tests-rpc-lanes-local-event-local-hook")
      .on(event)
      .run(async () => {
        localHookRuns += 1;
      })
      .build();

    const emitTask = defineTask({
      id: "tests-rpc-lanes-local-event-emit-task",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) => {
        await deps.eventManager.emit(
          event,
          { value: 2 },
          runtimeSource.task("tests-rpc-lanes-local-event-emit-task"),
        );
      },
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [lane] },
      },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-local-event-app",
      register: [
        event,
        localHook,
        emitTask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const rr = await run(app);
    await rr.runTask(emitTask as any);
    expect(eventCapture).not.toHaveBeenCalled();
    expect(localHookRuns).toBe(1);
    await rr.dispose();
  });

  it("uses eventWithResult communicator path for rpc-lane tagged events", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-event-return-lane").build();
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-event-return-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-event-return-communicator",
      init: async () => ({
        eventWithResult: async (_id: string, payload?: unknown) => {
          const input = payload as { value: number };
          return { value: input.value + 100 };
        },
      }),
    });

    const emitTask = defineTask({
      id: "tests-rpc-lanes-event-return-emit-task",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) =>
        deps.eventManager.emitWithResult(
          event,
          { value: 7 },
          runtimeSource.task("tests-rpc-lanes-event-return-emit-task"),
        ),
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-event-return-app",
      register: [
        event,
        emitTask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const rr = await run(app);
    await expect(rr.runTask(emitTask as any)).resolves.toEqual({ value: 107 });
    await rr.dispose();
  });

  it("fails when serve profile lane has no communicator binding", async () => {
    const lane = r
      .rpcLane("tests-rpc-lanes-serve-missing-binding-lane")
      .build();
    const task = defineTask({
      id: "tests-rpc-lanes-serve-missing-binding-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const topology = r.rpcLane.topology({
      profiles: {
        server: { serve: [lane] },
      },
      bindings: [],
    } as any);
    const app = defineResource({
      id: "tests-rpc-lanes-serve-missing-binding-app",
      register: [task, rpcLanesResource.with({ profile: "server", topology })],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "runner.errors.rpcLane.bindingNotFound",
    });
  });

  it("fails when a tagged event lane has no communicator binding", async () => {
    const lane = r
      .rpcLane("tests-rpc-lanes-event-missing-binding-lane")
      .build();
    const event = defineEvent({
      id: "tests-rpc-lanes-event-missing-binding-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [],
    } as any);
    const app = defineResource({
      id: "tests-rpc-lanes-event-missing-binding-app",
      register: [event, rpcLanesResource.with({ profile: "client", topology })],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "runner.errors.rpcLane.bindingNotFound",
    });
  });

  it("fails when communicator resource does not return communicator contract", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-invalid-communicator-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-invalid-communicator-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-invalid-communicator-resource",
      init: async () => ({}) as any,
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-invalid-communicator-app",
      register: [
        task,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "runner.errors.rpcLane.communicatorResourceInvalid",
    });
  });

  it("fails when remote task route communicator lacks task()", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-task-contract-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-task-contract-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-task-contract-communicator",
      init: async () => ({
        event: async () => undefined,
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-task-contract-app",
      register: [
        task,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const rr = await run(app);
    await expect(rr.runTask(task as any)).rejects.toMatchObject({
      name: "runner.errors.rpcLane.communicatorContract",
    });
    await rr.dispose();
  });

  it("fails when remote event route communicator lacks event()", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-event-contract-lane").build();
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-event-contract-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-event-contract-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const emitTask = defineTask({
      id: "tests-rpc-lanes-event-contract-emit-task",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) => {
        await deps.eventManager.emit(
          event,
          { value: 4 },
          runtimeSource.task("tests-rpc-lanes-event-contract-emit-task"),
        );
      },
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-event-contract-app",
      register: [
        event,
        emitTask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const rr = await run(app);
    await expect(rr.runTask(emitTask as any)).rejects.toMatchObject({
      name: "runner.errors.rpcLane.communicatorContract",
    });
    await rr.dispose();
  });

  it("fails when configured profile does not exist", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-profile-missing-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-profile-missing-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-profile-missing-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        existing: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-profile-missing-app",
      register: [
        task,
        communicator,
        rpcLanesResource.with({ profile: "missing" as "existing", topology }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "runner.errors.rpcLane.profileNotFound",
    });
  });

  it("publishes serve allow-list to exposure guard computation", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-serve-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-serve-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const event = defineEvent({
      id: "tests-rpc-lanes-serve-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-serve-communicator",
      init: async () => ({
        task: async () => "remote",
        event: async () => undefined,
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        server: { serve: [lane] },
      },
      bindings: [{ lane, communicator, allowAsyncContext: false }],
    });
    const lanes = rpcLanesResource.with({ profile: "server", topology });
    const app = defineResource({
      id: "tests-rpc-lanes-serve-app",
      register: [task, event, communicator, lanes],
    });

    const rr = await run(app);
    const lanesValue = await rr.getResourceValue(lanes.resource as any);
    expect(lanesValue.serveTaskIds).toContain(task.id);
    expect(lanesValue.taskAllowAsyncContext[task.id]).toBe(false);
    expect(lanesValue.serveEventIds).toContain(event.id);
    expect(lanesValue.eventAllowAsyncContext[event.id]).toBe(false);
    await rr.dispose();
  });

  it("publishes lane async-context allowlist with default deny-all", async () => {
    const allowedCtx = r
      .asyncContext("tests-rpc-lanes-serve-ctx-allowed")
      .build();
    const laneDefault = r.rpcLane("tests-rpc-lanes-serve-default-none").build();
    const laneAllowed = r
      .rpcLane("tests-rpc-lanes-serve-allow-one")
      .asyncContexts([allowedCtx.id])
      .build();
    const defaultTask = defineTask({
      id: "tests-rpc-lanes-serve-default-none-task",
      tags: [globalTags.rpcLane.with({ lane: laneDefault })],
      run: async () => "local",
    });
    const allowedTask = defineTask({
      id: "tests-rpc-lanes-serve-allow-one-task",
      tags: [globalTags.rpcLane.with({ lane: laneAllowed })],
      run: async () => "local",
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-serve-ctx-communicator",
      init: async () => ({ task: async () => "remote" }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        server: { serve: [laneDefault, laneAllowed] },
      },
      bindings: [
        { lane: laneDefault, communicator },
        { lane: laneAllowed, communicator },
      ],
    });
    const lanes = rpcLanesResource.with({ profile: "server", topology });
    const app = defineResource({
      id: "tests-rpc-lanes-serve-ctx-app",
      register: [allowedCtx, defaultTask, allowedTask, communicator, lanes],
    });

    const rr = await run(app);
    const lanesValue = await rr.getResourceValue(lanes.resource as any);
    expect(lanesValue.taskAllowAsyncContext[defaultTask.id]).toBe(false);
    expect(lanesValue.taskAsyncContextAllowList[defaultTask.id]).toEqual([]);
    expect(lanesValue.taskAllowAsyncContext[allowedTask.id]).toBe(true);
    expect(lanesValue.taskAsyncContextAllowList[allowedTask.id]).toEqual([
      allowedCtx.id,
    ]);
    await rr.dispose();
  });

  it("supports legacy allowAsyncContext=true bridge when lane allowlist is omitted", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-serve-legacy-context-all").build();
    const task = defineTask({
      id: "tests-rpc-lanes-serve-legacy-context-all-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const event = defineEvent({
      id: "tests-rpc-lanes-serve-legacy-context-all-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-serve-legacy-context-all-communicator",
      init: async () => ({
        task: async () => "remote",
        event: async () => undefined,
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        server: { serve: [lane] },
      },
      bindings: [{ lane, communicator, allowAsyncContext: true }],
    });
    const lanes = rpcLanesResource.with({ profile: "server", topology });
    const app = defineResource({
      id: "tests-rpc-lanes-serve-legacy-context-all-app",
      register: [task, event, communicator, lanes],
    });

    const rr = await run(app);
    const lanesValue = await rr.getResourceValue(lanes.resource as any);
    expect(lanesValue.taskAllowAsyncContext[task.id]).toBe(true);
    expect(lanesValue.taskAsyncContextAllowList[task.id]).toBeUndefined();
    expect(lanesValue.eventAllowAsyncContext[event.id]).toBe(true);
    expect(lanesValue.eventAsyncContextAllowList[event.id]).toBeUndefined();
    await rr.dispose();
  });

  it("can auto-start and dispose exposure when exposure config is provided", async () => {
    const close = jest.fn(async () => undefined);
    const createExposureSpy = jest
      .spyOn(exposureModule, "createNodeExposure")
      .mockResolvedValue({
        close,
      } as any);

    const lane = r.rpcLane("tests-rpc-lanes-exposure-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-exposure-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-exposure-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const cfg = {
      profile: "server",
      topology: r.rpcLane.topology({
        profiles: {
          server: { serve: [lane] },
        },
        bindings: [{ lane, communicator }],
      }),
      exposure: {
        http: {
          basePath: "/__runner",
          listen: { port: 0 },
          auth: { allowAnonymous: true },
        },
      },
    } as const;

    const app = defineResource({
      id: "tests-rpc-lanes-exposure-app",
      register: [task, communicator, rpcLanesResource.with(cfg)],
    });

    const rr = await run(app);
    expect(createExposureSpy).toHaveBeenCalledTimes(1);
    await rr.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not start exposure when active profile serves no lanes", async () => {
    const createExposureSpy = jest.spyOn(exposureModule, "createNodeExposure");
    const warnSpy = jest.spyOn(exposureLoggingModule, "safeLogWarn");
    const lane = r.rpcLane("tests-rpc-lanes-exposure-not-served-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-exposure-not-served-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-exposure-not-served-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const cfg = {
      profile: "client",
      topology: r.rpcLane.topology({
        profiles: {
          client: { serve: [] },
        },
        bindings: [{ lane, communicator }],
      }),
      exposure: {
        http: {
          basePath: "/__runner",
          auth: { allowAnonymous: true },
        },
      },
    } as const;

    const app = defineResource({
      id: "tests-rpc-lanes-exposure-not-served-app",
      register: [task, communicator, rpcLanesResource.with(cfg)],
    });

    const rr = await run(app);
    expect(createExposureSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.anything(),
      "rpc-lanes.exposure.skipped",
      expect.objectContaining({
        reason: "no-served-task-or-event",
      }),
    );
    await rr.dispose();
  });

  it("fails when task is already routed by another resource", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-ownership-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-ownership-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-ownership-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });

    const markOwnershipResource = defineResource({
      id: "tests-rpc-lanes-ownership-marker",
      dependencies: {
        store: globalResources.store,
      },
      init: async (_config, deps) => {
        const store = deps.store as any;
        const taskEntry = store.tasks.get(task.id);
        taskEntry.task = {
          ...taskEntry.task,
          [symbolRpcLaneRoutedBy]: "tests.other.owner",
        };
        return null;
      },
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-ownership-app",
      register: [
        task,
        communicator,
        markOwnershipResource,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "runner.errors.rpcLane.ownershipConflict",
    });
  });
});
