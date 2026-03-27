import { r } from "../../../..";
import { resources, run } from "../../../node";
import { durableEventsArray } from "../../../durable/events";
import { durableShutdownAbortingHook } from "../../../durable/resources/durableShutdownAborting.hook";
import { durableRuntimeTag } from "../../../durable/tags/durableRuntime.tag";
import { durableWorkflowTag } from "../../../durable/tags/durableWorkflow.tag";

describe("durable: support resource registration", () => {
  it("registers durable tags and durable events once", async () => {
    const app = r
      .resource("durable-support-app")
      .register([resources.durable])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });

    expect(runtime.store.tags.has(durableRuntimeTag.id)).toBe(true);
    expect(runtime.store.getTagAccessor(durableRuntimeTag).resources).toEqual(
      [],
    );
    expect(runtime.store.tags.has(durableWorkflowTag.id)).toBe(true);
    expect(runtime.store.getTagAccessor(durableWorkflowTag).tasks).toEqual([]);

    for (const event of durableEventsArray) {
      expect(runtime.store.events.has(event.id)).toBe(true);
    }

    expect(runtime.store.hooks.has(durableShutdownAbortingHook.id)).toBe(true);

    await runtime.dispose();
  });

  it("keeps workflow backends leaf and forkable", () => {
    expect(resources.memoryWorkflow.register ?? []).toEqual([]);
    expect(resources.redisWorkflow.register ?? []).toEqual([]);

    expect(resources.memoryWorkflow.fork("durable-memory-a").id).toBe(
      "durable-memory-a",
    );
    expect(resources.redisWorkflow.fork("durable-redis-a").id).toBe(
      "durable-redis-a",
    );
  });
});
