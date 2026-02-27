import { defineEvent, defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalResources } from "../../../globals/globalResources";
import { globalTags } from "../../../globals/globalTags";
import { r } from "../../../public";
import { runtimeSource } from "../../../types/runtimeSource";
import { rpcLanesResource } from "../../rpc-lanes";

describe("rpcLanesResource event routing edge cases", () => {
  it("fails when a tagged rpc lane event has no binding", async () => {
    const lane = r.rpcLane("tests.rpc-lanes.event.unbound.lane").build();
    const event = defineEvent<{ value: number }>({
      id: "tests.rpc-lanes.event.unbound.event",
      tags: [globalTags.rpcLane.with({ lane })],
    });

    const emitTask = defineTask({
      id: "tests.rpc-lanes.event.unbound.emit-task",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) =>
        deps.eventManager.emit(
          event,
          { value: 5 },
          runtimeSource.task("tests.rpc-lanes.event.unbound.emit-task"),
        ),
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [],
    } as any);

    const app = defineResource({
      id: "tests.rpc-lanes.event.unbound.app",
      register: [
        event,
        emitTask,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "runner.errors.rpcLane.bindingNotFound",
    });
  });

  it("handles eventWithResult returning undefined without mutating emission result", async () => {
    const lane = r
      .rpcLane("tests.rpc-lanes.event.undefined-return.lane")
      .build();
    const event = defineEvent<{ value: number }>({
      id: "tests.rpc-lanes.event.undefined-return.event",
      tags: [globalTags.rpcLane.with({ lane })],
    });

    const communicator = defineResource({
      id: "tests.rpc-lanes.event.undefined-return.communicator",
      init: async () => ({
        eventWithResult: async () => undefined,
      }),
    });

    let localHookRuns = 0;
    const localHook = r
      .hook("tests.rpc-lanes.event.undefined-return.local-hook")
      .on(event)
      .run(async () => {
        localHookRuns += 1;
      })
      .build();

    const emitTask = defineTask({
      id: "tests.rpc-lanes.event.undefined-return.emit-task",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) =>
        deps.eventManager.emitWithResult(
          event,
          { value: 11 },
          runtimeSource.task(
            "tests.rpc-lanes.event.undefined-return.emit-task",
          ),
        ),
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests.rpc-lanes.event.undefined-return.app",
      register: [
        event,
        communicator,
        localHook,
        emitTask,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const rr = await run(app);
    await expect(rr.runTask(emitTask as any)).resolves.toEqual({ value: 11 });
    expect(localHookRuns).toBe(0);
    await rr.dispose();
  });
});
