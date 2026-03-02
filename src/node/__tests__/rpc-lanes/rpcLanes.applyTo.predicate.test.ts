import { defineEvent, defineResource, defineTask } from "../../../define";
import { globalResources } from "../../../globals/globalResources";
import { run } from "../../../run";
import { runtimeSource } from "../../../types/runtimeSource";
import { r } from "../../../public";
import { rpcLanesResource } from "../../rpc-lanes";

describe("rpcLanes applyTo predicate", () => {
  it("routes predicate-matched tasks remotely without explicit rpcLane tags", async () => {
    const task = defineTask({
      id: "tests.rpc-lanes.apply-to.predicate.task",
      run: async () => "local",
    });
    const lane = r
      .rpcLane("tests.rpc-lanes.apply-to.predicate.lane")
      .applyTo((candidate) => "run" in candidate && candidate.id === task.id)
      .build();
    const communicator = defineResource({
      id: "tests.rpc-lanes.apply-to.predicate.communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });

    const topology = r.rpcLane.topology({
      profiles: { client: { serve: [] } },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests.rpc-lanes.apply-to.predicate.app",
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

  it("routes predicate-matched events remotely without explicit rpcLane tags", async () => {
    const event = defineEvent<{ value: number }>({
      id: "tests.rpc-lanes.apply-to.predicate.event",
    });
    const lane = r
      .rpcLane("tests.rpc-lanes.apply-to.predicate.event.lane")
      .applyTo((candidate) => candidate.id === event.id)
      .build();
    const eventCapture = jest.fn(async (_id: string, _payload?: unknown) => {
      void _id;
      void _payload;
    });
    const communicator = defineResource({
      id: "tests.rpc-lanes.apply-to.predicate.event.communicator",
      init: async () => ({
        event: eventCapture,
      }),
    });
    const emitTask = defineTask({
      id: "tests.rpc-lanes.apply-to.predicate.event.emit",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) =>
        deps.eventManager.emit(
          event,
          { value: 7 },
          runtimeSource.task("tests.rpc-lanes.apply-to.predicate.event.emit"),
        ),
    });

    const topology = r.rpcLane.topology({
      profiles: { client: { serve: [] } },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests.rpc-lanes.apply-to.predicate.event.app",
      register: [
        event,
        emitTask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const runtime = await run(app);
    await runtime.runTask(emitTask as any);
    expect(eventCapture).toHaveBeenCalledTimes(1);
    expect(eventCapture.mock.calls[0]?.[0]).toBe(event.id);
    await runtime.dispose();
  });
});
