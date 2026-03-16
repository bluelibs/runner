import { defineEvent, defineResource, defineTask } from "../../../define";
import { globalResources } from "../../../globals/globalResources";
import { run } from "../../../run";
import { runtimeSource } from "../../../types/runtimeSource";
import { isSameDefinition, r } from "../../../public";
import { rpcLanesResource } from "../../rpc-lanes";

describe("rpcLanes applyTo predicate", () => {
  it("routes predicate-matched tasks remotely without explicit rpcLane tags", async () => {
    const task = defineTask({
      id: "tests-rpc-lanes-apply-to-predicate-task",
      run: async () => "local",
    });
    const lane = r
      .rpcLane("tests-rpc-lanes-apply-to-predicate-lane")
      .applyTo(
        (candidate) => "run" in candidate && isSameDefinition(candidate, task),
      )
      .build();
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-predicate-communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });

    const topology = r.rpcLane.topology({
      profiles: { client: { serve: [] } },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-predicate-app",
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
      id: "tests-rpc-lanes-apply-to-predicate-event",
    });
    const lane = r
      .rpcLane("tests-rpc-lanes-apply-to-predicate-event-lane")
      .applyTo((candidate) => isSameDefinition(candidate, event))
      .build();
    const eventCapture = jest.fn(async (_id: string, _payload?: unknown) => {
      void _id;
      void _payload;
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-predicate-event-communicator",
      init: async () => ({
        event: eventCapture,
      }),
    });
    const emitTask = defineTask({
      id: "tests-rpc-lanes-apply-to-predicate-event-emit",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) =>
        deps.eventManager.emit(
          event,
          { value: 7 },
          runtimeSource.task("tests-rpc-lanes-apply-to-predicate-event-emit"),
        ),
    });

    const topology = r.rpcLane.topology({
      profiles: { client: { serve: [] } },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-predicate-event-app",
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
    expect(eventCapture.mock.calls[0]?.[0]).toBe(
      runtime.store.findIdByDefinition(event),
    );
    await runtime.dispose();
  });

  it("routes only the intended sibling event when local ids collide", async () => {
    const leftEvent = defineEvent<{ value: number }>({
      id: "shared-event",
    });
    const rightEvent = defineEvent<{ value: number }>({
      id: "shared-event",
    });

    const lane = r
      .rpcLane("tests-rpc-lanes-apply-to-predicate-shared-event-lane")
      .applyTo((candidate) => isSameDefinition(candidate, rightEvent))
      .build();

    const eventCapture = jest.fn(async (_id: string, _payload?: unknown) => {
      void _id;
      void _payload;
    });
    const communicator = defineResource({
      id: "tests-rpc-lanes-apply-to-predicate-shared-event-communicator",
      init: async () => ({
        event: eventCapture,
      }),
    });

    const leftResource = defineResource({
      id: "left",
      register: [leftEvent],
    });
    const rightResource = defineResource({
      id: "right",
      register: [rightEvent],
    });

    const emitTask = defineTask({
      id: "tests-rpc-lanes-apply-to-predicate-shared-event-emit",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) => {
        await deps.eventManager.emit(
          leftEvent,
          { value: 1 },
          runtimeSource.task(
            "tests-rpc-lanes-apply-to-predicate-shared-event-emit",
          ),
        );
        await deps.eventManager.emit(
          rightEvent,
          { value: 2 },
          runtimeSource.task(
            "tests-rpc-lanes-apply-to-predicate-shared-event-emit",
          ),
        );
      },
    });

    const topology = r.rpcLane.topology({
      profiles: { client: { serve: [] } },
      bindings: [{ lane, communicator }],
    });

    const app = defineResource({
      id: "tests-rpc-lanes-apply-to-predicate-shared-event-app",
      register: [
        leftResource,
        rightResource,
        emitTask,
        communicator,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const runtime = await run(app);
    await runtime.runTask(emitTask as any);

    expect(eventCapture).toHaveBeenCalledTimes(1);
    expect(eventCapture.mock.calls[0]?.[1]).toEqual({ value: 2 });

    await runtime.dispose();
  });
});
