import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalTags } from "../../../globals/globalTags";
import { r } from "../../../public";
import { RemoteLaneTransportError } from "../../../remote-lanes/http/protocol";
import { rpcLanesResource } from "../../rpc-lanes";

function timeoutCommunicator(id: string, remoteTask: jest.Mock) {
  return defineResource({
    id,
    init: async () => ({ task: remoteTask }),
  });
}

describe("rpcLanesResource retry", () => {
  it("applies the configured binding retry policy end to end", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-retry-e2e-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-retry-e2e-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const remoteTask = jest.fn(async () => {
      throw new RemoteLaneTransportError("TIMEOUT", "slow");
    });
    const communicator = timeoutCommunicator(
      "tests-rpc-lanes-retry-e2e-communicator",
      remoteTask,
    );
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator, retry: { maxAttempts: 2 } }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-retry-e2e-app",
      register: [
        task,
        communicator,
        rpcLanesResource.with({ profile: "client", topology, mode: "network" }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task as any)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(remoteTask).toHaveBeenCalledTimes(2);
    await runtime.dispose();
  });

  it("retries with the default policy when no retry is configured", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-retry-default-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-retry-default-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const remoteTask = jest.fn(async () => {
      throw new RemoteLaneTransportError("TIMEOUT", "slow");
    });
    const communicator = timeoutCommunicator(
      "tests-rpc-lanes-retry-default-communicator",
      remoteTask,
    );
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator }],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-retry-default-app",
      register: [
        task,
        communicator,
        rpcLanesResource.with({ profile: "client", topology, mode: "network" }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task as any)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(remoteTask).toHaveBeenCalledTimes(3);
    await runtime.dispose();
  });

  it("supports function delays in the binding retry policy", async () => {
    const lane = r.rpcLane("tests-rpc-lanes-retry-strategy-lane").build();
    const task = defineTask({
      id: "tests-rpc-lanes-retry-strategy-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "local",
    });
    const seenAttempts: number[] = [];
    const remoteTask = jest.fn(async () => {
      throw new RemoteLaneTransportError("TIMEOUT", "slow");
    });
    const communicator = timeoutCommunicator(
      "tests-rpc-lanes-retry-strategy-communicator",
      remoteTask,
    );
    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [
        {
          lane,
          communicator,
          retry: {
            maxAttempts: 2,
            delayMs: (attempt) => {
              seenAttempts.push(attempt);
              return 0;
            },
          },
        },
      ],
    });
    const app = defineResource({
      id: "tests-rpc-lanes-retry-strategy-app",
      register: [
        task,
        communicator,
        rpcLanesResource.with({ profile: "client", topology, mode: "network" }),
      ],
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task as any)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(remoteTask).toHaveBeenCalledTimes(2);
    expect(seenAttempts).toEqual([0]);
    await runtime.dispose();
  });

  it.each([0, 1.5])(
    "fails fast when binding maxAttempts is %s",
    async (maxAttempts) => {
      const slug = String(maxAttempts).replace(".", "-");
      const lane = r
        .rpcLane(`tests-rpc-lanes-retry-invalid-attempts-${slug}-lane`)
        .build();
      const communicator = timeoutCommunicator(
        `tests-rpc-lanes-retry-invalid-attempts-${slug}-communicator`,
        jest.fn(),
      );
      const app = defineResource({
        id: `tests-rpc-lanes-retry-invalid-attempts-${slug}-app`,
        register: [
          communicator,
          rpcLanesResource.with({
            profile: "client",
            topology: r.rpcLane.topology({
              profiles: { client: { serve: [] } },
              bindings: [{ lane, communicator, retry: { maxAttempts } }],
            }),
            mode: "network",
          }),
        ],
      });

      await expect(run(app)).rejects.toThrow('field "maxAttempts"');
    },
  );

  it.each([-1, Number.NaN])(
    "fails fast when binding delayMs is %s",
    async (delayMs) => {
      const lane = r
        .rpcLane(`tests-rpc-lanes-retry-invalid-delay-${String(delayMs)}-lane`)
        .build();
      const communicator = timeoutCommunicator(
        `tests-rpc-lanes-retry-invalid-delay-${String(delayMs)}-communicator`,
        jest.fn(),
      );
      const app = defineResource({
        id: `tests-rpc-lanes-retry-invalid-delay-${String(delayMs)}-app`,
        register: [
          communicator,
          rpcLanesResource.with({
            profile: "client",
            topology: r.rpcLane.topology({
              profiles: { client: { serve: [] } },
              bindings: [{ lane, communicator, retry: { delayMs } }],
            }),
            mode: "network",
          }),
        ],
      });

      await expect(run(app)).rejects.toThrow('field "delayMs"');
    },
  );
});
