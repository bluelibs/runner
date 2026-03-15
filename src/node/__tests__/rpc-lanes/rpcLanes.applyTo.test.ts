import { defineEvent, defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalResources } from "../../../globals/globalResources";
import { globalTags } from "../../../globals/globalTags";
import { runtimeSource } from "../../../types/runtimeSource";
import { r } from "../../../public";
import { eventLanesResource } from "../../event-lanes";
import { rpcLanesResource } from "../../rpc-lanes";

describe("rpcLanes applyTo", () => {
  it("routes applyTo task targets remotely without explicit rpcLane tags", async () => {
    const task = defineTask({
      id: "tests-rpc-lanes-apply-to-remote-task",
      run: async () => "local",
    });
    const lane = r
      .rpcLane("tests-rpc-lanes-apply-to-remote-task-lane")
      .applyTo([task])
      .build();
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-remote-task-communicator",
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
      id: "tests-rpc-lanes-apply-to-remote-task-app",
      register: [
        task,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task as any)).resolves.toBe("remote");
    await runtime.dispose();
  });

  it("allows same-lane task tag + applyTo without re-assignment conflicts", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-apply-to-same-lane-task").build();
    const task = defineTask({
      id: "tests-rpc-lanes-apply-to-same-lane-task-target",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const configuredLane = r.rpcLane(lane.id).applyTo([task]).build();
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-same-lane-task-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane: configuredLane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-same-lane-task-app",
      register: [
        task,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });
    const runtime = await run(app);
    await expect(runtime.runTask(task as any)).resolves.toBe("remote");
    await runtime.dispose();
  });

  it("routes applyTo event targets remotely without explicit rpcLane tags", async () => {
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-apply-to-remote-event",
    });
    const lane = r
      .rpcLane("tests-rpc-lanes-apply-to-remote-event-lane")
      .applyTo([event])
      .build();
    const eventCapture = jest.fn(async () => undefined);
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-remote-event-communicator",
      init: async () => ({
        event: eventCapture,
      }),
    });
    const emitTask = defineTask({
      id: "tests-rpc-lanes-apply-to-remote-event-emit",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) =>
        deps.eventManager.emit(
          event,
          { value: 7 },
          runtimeSource.task("tests-rpc-lanes-apply-to-remote-event-emit"),
        ),
    });

    let localHookRuns = 0;
    const localHook = r
      .hook("tests-rpc-lanes-apply-to-remote-event-hook")
      .on(event)
      .run(async () => {
        localHookRuns += 1;
      })
      .build();

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-remote-event-app",
      register: [
        event,
        localHook,
        emitTask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const runtime = await run(app);
    await runtime.runTask(emitTask as any);
    expect(eventCapture).toHaveBeenCalledWith(
      runtime.store.findIdByDefinition(event),
      { value: 7 },
      {
        signal: undefined,
      },
    );
    expect(localHookRuns).toBe(0);
    await runtime.dispose();
  });

  it("allows same-lane event tag + applyTo without re-assignment conflicts", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-apply-to-same-lane-event").build();
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-apply-to-same-lane-event-target",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const configuredLane = r.rpcLane(lane.id).applyTo([event.id]).build();
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-same-lane-event-communicator",
      init: async () => ({
        event: async () => undefined,
      }),
    });
    const emitTask = defineTask({
      id: "tests-rpc-lanes-apply-to-same-lane-event-emit",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) =>
        deps.eventManager.emit(
          event,
          { value: 3 },
          runtimeSource.task("tests-rpc-lanes-apply-to-same-lane-event-emit"),
        ),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane: configuredLane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-same-lane-event-app",
      register: [
        event,
        emitTask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });
    const runtime = await run(app);
    await expect(runtime.runTask(emitTask as any)).resolves.toBeUndefined();
    await runtime.dispose();
  });

  it("fails fast when applyTo string resolves to a non task/event definition", async () => {
    const notATask = defineResource({
      id: "tests-rpc-lanes-apply-to-invalid-target-resource",
      init: async () => "ok",
    });
    const lane = r
      .rpcLane("tests-rpc-lanes-apply-to-invalid-target-lane")
      .applyTo([notATask.id])
      .build();
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-invalid-target-communicator",
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
      id: "tests-rpc-lanes-apply-to-invalid-target-app",
      register: [
        notATask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    await expect(run(app)).rejects.toThrow(
      `rpcLane "${lane.id}" applyTo target "${notATask.id}" must reference a task or event, but resolved to a non-task/event definition.`,
    );
  });

  it("fails when rpcLane applyTo collides with eventLane applyTo on the same event", async () => {
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-apply-to-cross-lane-event",
    });
    const rpc = r
      .rpcLane("tests-rpc-lanes-apply-to-cross-lane-rpc")
      .applyTo([event])
      .build();
    const eventLane = r
      .eventLane("tests-rpc-lanes-apply-to-cross-lane-event-lane")
      .applyTo([event])
      .build();
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-cross-lane-communicator",
      init: async () => ({
        event: async () => undefined,
      }),
    });

    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-cross-lane-app",
      register: [
        event,
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: { worker: { consume: [eventLane] } },
            bindings: [],
          },
        }),
        communicator,
        rpcLanesResource.with({
          profile: "client",
          topology: {
            profiles: { client: { serve: [] } },
            bindings: [{ lane: rpc, communicator }],
          },
        }),
      ],
    });

    await expect(run(app)).rejects.toThrow(
      /already assigned to an (rpcLane|event lane)/,
    );
  });
});
