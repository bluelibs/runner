import {
  asyncContexts,
  defineResource,
  defineTask,
  middleware,
  run,
} from "../../../";
import { identityContextRequiredError } from "../../../errors";
import { globalTags } from "../../../globals/globalTags";
import { r } from "../../../public";
import { rpcLanesResource } from "../../rpc-lanes";

describe("rpcLanes local-simulated identity enforcement", () => {
  it("still enforces subtree task identity gates", async () => {
    const lane = r
      .rpcLane("tests-rpc-lanes-simulated-identity-subtree-lane")
      .build();
    const task = defineTask({
      id: "tests-rpc-lanes-simulated-identity-subtree-task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => "secured",
    });
    const app = defineResource({
      id: "tests-rpc-lanes-simulated-identity-subtree-app",
      subtree: {
        tasks: {
          identity: { user: true },
        },
      },
      register: [
        task,
        rpcLanesResource.with({
          profile: "client",
          topology: r.rpcLane.topology({
            profiles: {
              client: { serve: [] },
            },
            bindings: [],
          }),
          mode: "local-simulated",
        }),
      ],
    });

    const runtime = await run(app);

    let thrown: unknown;
    try {
      await runtime.runTask(task as any);
    } catch (error) {
      thrown = error;
    }

    expect(identityContextRequiredError.is(thrown)).toBe(true);
    await runtime.dispose();
  });

  it("still enforces explicit identityChecker middleware", async () => {
    const lane = r
      .rpcLane("tests-rpc-lanes-simulated-identity-explicit-lane")
      .build();
    const task = defineTask({
      id: "tests-rpc-lanes-simulated-identity-explicit-task",
      tags: [globalTags.rpcLane.with({ lane })],
      middleware: [middleware.task.identityChecker.with({})],
      run: async () => asyncContexts.identity.tryUse()?.tenantId ?? "missing",
    });
    const app = defineResource({
      id: "tests-rpc-lanes-simulated-identity-explicit-app",
      register: [
        task,
        rpcLanesResource.with({
          profile: "client",
          topology: r.rpcLane.topology({
            profiles: {
              client: { serve: [] },
            },
            bindings: [],
          }),
          mode: "local-simulated",
        }),
      ],
    });

    const runtime = await run(app);

    let thrown: unknown;
    try {
      await runtime.runTask(task as any);
    } catch (error) {
      thrown = error;
    }

    expect(identityContextRequiredError.is(thrown)).toBe(true);
    await runtime.dispose();
  });
});
