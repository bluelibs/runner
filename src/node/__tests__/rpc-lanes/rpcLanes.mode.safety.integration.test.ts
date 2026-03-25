import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalTags } from "../../../globals/globalTags";
import { rpcLanesResource } from "../../rpc-lanes";
import { r } from "../../../public";
import {
  createClientRpcLaneTopology,
  createMockRpcLaneCommunicator,
} from "./test.utils";

describe("rpcLanesResource mode safety", () => {
  it("transparent mode does not require communicator dependency resolution", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-transparent-no-deps-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-transparent-no-deps-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const communicator = createMockRpcLaneCommunicator(
      "tests-rpc-lanes-transparent-no-deps-communicator",
    );
    const topology = createClientRpcLaneTopology([{ lane, communicator }]);

    const app = defineResource({
      id: "tests-rpc-lanes-transparent-no-deps-app",
      register: [
        task,
        rpcLanesResource.with({
          profile: "client",
          mode: "transparent",
          topology,
        }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task as any)).resolves.toBe("local");
    await runtime.dispose();
  });

  it("local-simulated mode does not require communicator dependency resolution", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-simulated-no-deps-lane").build();
    const task = defineTask<{ count: number }>({
      id: "tests-rpc-lanes-simulated-no-deps-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async (input) => {
        input.count += 1;
        return input.count;
      },
    });
    const communicator = createMockRpcLaneCommunicator(
      "tests-rpc-lanes-simulated-no-deps-communicator",
    );
    const topology = createClientRpcLaneTopology([{ lane, communicator }]);

    const app = defineResource({
      id: "tests-rpc-lanes-simulated-no-deps-app",
      register: [
        task,
        rpcLanesResource.with({
          profile: "client",
          mode: "local-simulated",
          topology,
        }),
      ],
    });

    const runtime = await run(app);
    const payload = { count: 1 };
    await expect(runtime.runTask(task as any, payload)).resolves.toBe(2);
    expect(payload.count).toBe(1);
    await runtime.dispose();
  });

  it("fails fast when rpc lane topology binds the same lane multiple times", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-duplicate-binding-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-duplicate-binding-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });

    const communicatorA = createMockRpcLaneCommunicator(
      "tests-rpc-lanes-duplicate-binding-communicator-a",
      { task: async () => "remote-a" },
    );
    const communicatorB = createMockRpcLaneCommunicator(
      "tests-rpc-lanes-duplicate-binding-communicator-b",
      { task: async () => "remote-b" },
    );
    const topology = createClientRpcLaneTopology([
      { lane, communicator: communicatorA },
      { lane, communicator: communicatorB },
    ]);

    const app = defineResource({
      id: "tests-rpc-lanes-duplicate-binding-app",
      register: [
        task,
        communicatorA,
        communicatorB,
        rpcLanesResource.with({ profile: "client", topology }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "rpcLane-duplicateBinding",
    });
  });

  it("fails when exposure.http is configured outside network mode", async () => {
    const topology = createClientRpcLaneTopology([]);

    const app = defineResource({
      id: "tests-rpc-lanes-mode-exposure-conflict-app",
      register: [
        rpcLanesResource.with({
          profile: "client",
          topology,
          mode: "transparent",
          exposure: {
            http: {
              basePath: "/__runner",
              listen: { port: 0 },
              auth: { allowAnonymous: true },
            },
          },
        }),
      ],
    });

    await expect(run(app)).rejects.toMatchObject({
      name: "rpcLane-exposureMode",
    });
  });
});
