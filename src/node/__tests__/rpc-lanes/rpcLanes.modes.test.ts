import { defineEvent, defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalResources } from "../../../globals/globalResources";
import { globalTags } from "../../../globals/globalTags";
import { r } from "../../../public";
import { runtimeSource } from "../../../types/runtimeSource";
import { symbolRpcLaneRoutedBy } from "../../../types/symbols";
import { rpcLanesResource } from "../../rpc-lanes";

describe("rpcLanesResource modes", () => {
  it("transparent mode bypasses rpc lane transport and executes tagged tasks locally", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-mode-transparent-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-mode-transparent-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-mode-transparent-app",
      register: [
        task,
        rpcLanesResource.with({
          profile: "client",
          topology,
          mode: "transparent",
        }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task as any)).resolves.toBe("local");
    await runtime.dispose();
  });

  it("local-simulated mode roundtrips task input/output through serializer boundaries", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-mode-simulated-task-lane").build();
    const task = defineTask<{ nested: { count: number } }>({
      id: "tests-rpc-lanes-mode-simulated-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async (input) => {
        input.nested.count = 99;
        return { count: input.nested.count };
      },
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-mode-simulated-task-app",
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
    const payload = { nested: { count: 1 } };
    await expect(runtime.runTask(task as any, payload)).resolves.toEqual({
      count: 99,
    });
    expect(payload.nested.count).toBe(1);
    await runtime.dispose();
  });

  it("local-simulated mode roundtrips rpc-lane event payloads through serializer boundaries", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-mode-simulated-event-lane").build();
    const event = defineEvent<{ value: number }>({
      id: "tests-rpc-lanes-mode-simulated-event",
      tags: [globalTags.rpcLane.with({ lane })],
    });

    const mutateHook = r
      .hook("tests-rpc-lanes-mode-simulated-event-hook")
      .on(event)
      .run(async (emission) => {
        emission.data.value += 1;
      })
      .build();

    const emitTask = defineTask<{ value: number }, Promise<{ value: number }>>({
      id: "tests-rpc-lanes-mode-simulated-event-emit-task",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (input, deps) =>
        deps.eventManager.emitWithResult(
          event,
          input,
          runtimeSource.task("tests-rpc-lanes-mode-simulated-event-emit-task"),
        ),
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-mode-simulated-event-app",
      register: [
        event,
        mutateHook,
        emitTask,
        rpcLanesResource.with({
          profile: "client",
          topology,
          mode: "local-simulated",
        }),
      ],
    });

    const runtime = await run(app);
    const payload = { value: 1 };
    await expect(runtime.runTask(emitTask as any, payload)).resolves.toEqual({
      value: 2,
    });
    expect(payload.value).toBe(1);
    await runtime.dispose();
  });

  it("local-simulated mode fails when task is already routed by another resource", async () => {
    const lane = r
      .rpcLane("tests-rpc-lanes-mode-simulated-ownership-lane")
      .build();
    const task = defineTask({
      id: "tests-rpc-lanes-mode-simulated-ownership-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });

    const markOwnershipResource = defineResource({
      id: "tests-rpc-lanes-mode-simulated-ownership-marker",
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
      bindings: [],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-mode-simulated-ownership-app",
      register: [
        task,
        markOwnershipResource,
        rpcLanesResource.with({
          profile: "client",
          topology,
          mode: "local-simulated",
        }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "rpcLane-ownershipConflict",
    });
  });
});
