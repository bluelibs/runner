import { defineResource, defineTask } from "../../../define";
import { globalTags } from "../../../globals/globalTags";
import { run } from "../../../run";
import { r } from "../../../public";
import { rpcLanesResource } from "../../rpc-lanes";

describe("rpcLanes applyTo override IoC", () => {
  it("routes to applyTo lane even when task is tagged for another lane", async () => {
    const laneA = r.rpcLane("tests.rpc-lanes.apply-to.override-ioc.a").build();
    const task = defineTask({
      id: "tests.rpc-lanes.apply-to.override-ioc.task",
      tags: [globalTags.rpcLane.with({ lane: laneA })],
      run: async () => "local",
    });

    const laneB = r
      .rpcLane("tests.rpc-lanes.apply-to.override-ioc.b")
      .applyTo([task])
      .build();

    const communicatorA = defineResource({
      id: "tests.rpc-lanes.apply-to.override-ioc.communicator.a",
      init: async () => ({
        task: async () => "remote-a",
      }),
    });
    const communicatorB = defineResource({
      id: "tests.rpc-lanes.apply-to.override-ioc.communicator.b",
      init: async () => ({
        task: async () => "remote-b",
      }),
    });

    const topology = r.rpcLane.topology({
      profiles: { client: { serve: [] } },
      bindings: [
        { lane: laneA, communicator: communicatorA },
        { lane: laneB, communicator: communicatorB },
      ],
    });

    const app = defineResource({
      id: "tests.rpc-lanes.apply-to.override-ioc.app",
      register: [
        task,
        communicatorA,
        communicatorB,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task as any)).resolves.toBe("remote-b");
    await runtime.dispose();
  });
});

