import { defineEvent, defineResource, defineTask } from "../../../define";
import { globalResources } from "../../../globals/globalResources";
import { globalTags } from "../../../globals/globalTags";
import { r } from "../../../public";
import { run } from "../../../run";
import { runtimeSource } from "../../../types/runtimeSource";
import { rpcLanesResource } from "../../rpc-lanes";

describe("rpcLanes local-simulated async-context policy", () => {
  it("defaults to forwarding no async contexts for local-simulated tasks", async () => {
    const allowedContext = r
      .asyncContext<{ value: string }>("tests.rpc-lanes.simulated.ctx.allowed")
      .build();
    const blockedContext = r
      .asyncContext<{ value: string }>("tests.rpc-lanes.simulated.ctx.blocked")
      .build();
    const lane = r
      .rpcLane("tests.rpc-lanes.simulated.ctx.default-none")
      .build();
    const task = defineTask({
      id: "tests.rpc-lanes.simulated.ctx.default-none.task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => {
        const readAllowed = () => {
          try {
            return allowedContext.use().value;
          } catch {
            return "missing";
          }
        };
        const readBlocked = () => {
          try {
            return blockedContext.use().value;
          } catch {
            return "missing";
          }
        };
        return {
          allowed: readAllowed(),
          blocked: readBlocked(),
        };
      },
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [],
    });
    const app = defineResource({
      id: "tests.rpc-lanes.simulated.ctx.default-none.app",
      register: [
        allowedContext,
        blockedContext,
        task,
        rpcLanesResource.with({
          profile: "client",
          topology,
          mode: "local-simulated",
        }),
      ],
    });

    const runtime = await run(app);
    const result = await allowedContext.provide({ value: "A" }, async () =>
      blockedContext.provide({ value: "B" }, async () =>
        runtime.runTask(task as any),
      ),
    );

    expect(result).toEqual({
      allowed: "missing",
      blocked: "missing",
    });
    await runtime.dispose();
  });

  it("rehydrates only allowlisted async contexts for local-simulated events", async () => {
    const allowedContext = r
      .asyncContext<{
        value: string;
      }>("tests.rpc-lanes.simulated.event.ctx.allowed")
      .build();
    const blockedContext = r
      .asyncContext<{
        value: string;
      }>("tests.rpc-lanes.simulated.event.ctx.blocked")
      .build();
    const lane = r
      .rpcLane("tests.rpc-lanes.simulated.event.ctx.allowlisted")
      .asyncContexts([allowedContext.id])
      .build();
    const event = defineEvent<{ value: number }>({
      id: "tests.rpc-lanes.simulated.event.ctx.allowlisted.event",
      tags: [globalTags.rpcLane.with({ lane })],
    });
    const seen = {
      allowed: "missing",
      blocked: "missing",
    };
    const hook = r
      .hook("tests.rpc-lanes.simulated.event.ctx.allowlisted.hook")
      .on(event)
      .run(async () => {
        try {
          seen.allowed = allowedContext.use().value;
        } catch {
          seen.allowed = "missing";
        }
        try {
          seen.blocked = blockedContext.use().value;
        } catch {
          seen.blocked = "missing";
        }
      })
      .build();
    const emitTask = defineTask({
      id: "tests.rpc-lanes.simulated.event.ctx.allowlisted.emit-task",
      dependencies: {
        eventManager: globalResources.eventManager,
      },
      run: async (_input, deps) =>
        deps.eventManager.emitWithResult(
          event,
          { value: 1 },
          runtimeSource.task(
            "tests.rpc-lanes.simulated.event.ctx.allowlisted.emit-task",
          ),
        ),
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [],
    });
    const app = defineResource({
      id: "tests.rpc-lanes.simulated.event.ctx.allowlisted.app",
      register: [
        allowedContext,
        blockedContext,
        event,
        hook,
        emitTask,
        rpcLanesResource.with({
          profile: "client",
          topology,
          mode: "local-simulated",
        }),
      ],
    });

    const runtime = await run(app);
    await allowedContext.provide({ value: "A" }, async () =>
      blockedContext.provide({ value: "B" }, async () =>
        runtime.runTask(emitTask as any),
      ),
    );

    expect(seen).toEqual({
      allowed: "A",
      blocked: "missing",
    });
    await runtime.dispose();
  });

  it("forwards all async contexts in local-simulated mode when legacy allowAsyncContext is true", async () => {
    const firstContext = r
      .asyncContext<{ value: string }>("tests.rpc-lanes.simulated.ctx.first")
      .build();
    const secondContext = r
      .asyncContext<{ value: string }>("tests.rpc-lanes.simulated.ctx.second")
      .build();
    const lane = r.rpcLane("tests.rpc-lanes.simulated.ctx.legacy-all").build();
    const task = defineTask({
      id: "tests.rpc-lanes.simulated.ctx.legacy-all.task",
      tags: [globalTags.rpcLane.with({ lane })],
      run: async () => {
        const readFirst = () => {
          try {
            return firstContext.use().value;
          } catch {
            return "missing";
          }
        };
        const readSecond = () => {
          try {
            return secondContext.use().value;
          } catch {
            return "missing";
          }
        };
        return {
          first: readFirst(),
          second: readSecond(),
        };
      },
    });
    const communicator = defineResource({
      id: "tests.rpc-lanes.simulated.ctx.legacy-all.communicator",
      init: async () => ({
        task: async () => "remote",
      }),
    });

    const topology = r.rpcLane.topology({
      profiles: {
        client: { serve: [] },
      },
      bindings: [{ lane, communicator, allowAsyncContext: true }],
    });
    const app = defineResource({
      id: "tests.rpc-lanes.simulated.ctx.legacy-all.app",
      register: [
        firstContext,
        secondContext,
        task,
        communicator,
        rpcLanesResource.with({
          profile: "client",
          topology,
          mode: "local-simulated",
        }),
      ],
    });

    const runtime = await run(app);
    const result = await firstContext.provide({ value: "A" }, async () =>
      secondContext.provide({ value: "B" }, async () =>
        runtime.runTask(task as any),
      ),
    );

    expect(result).toEqual({
      first: "A",
      second: "B",
    });
    await runtime.dispose();
  });
});
