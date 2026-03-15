import { createMessageError } from "../../../errors";
import { MemoryEventLaneQueue } from "../../event-lanes/MemoryEventLaneQueue";
import { eventLanesResource } from "../../event-lanes";
import { r, run, tags } from "../../..";

function readContextValue(
  context: { use(): { value: string } },
  fallback = "missing",
): string {
  try {
    return context.use().value;
  } catch {
    return fallback;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw createMessageError("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("event-lanes async-context policy in network mode", () => {
  it("defaults to forwarding no async contexts", async () => {
    const allowedContext = r
      .asyncContext<{ value: string }>("tests-event-lanes-network-ctx-allowed")
      .build();
    const blockedContext = r
      .asyncContext<{ value: string }>("tests-event-lanes-network-ctx-blocked")
      .build();
    const lane = r.eventLane("tests-event-lanes-network-ctx-none").build();
    const queue = new MemoryEventLaneQueue();
    const event = r
      .event("tests-event-lanes-network-ctx-none-event")
      .tags([tags.eventLane.with({ lane })])
      .build();
    const seen = {
      allowed: "pending",
      blocked: "pending",
    };
    const hook = r
      .hook("tests-event-lanes-network-ctx-none-hook")
      .on(event)
      .run(async () => {
        seen.allowed = readContextValue(allowedContext);
        seen.blocked = readContextValue(blockedContext);
      })
      .build();
    const emitTask = r
      .task("tests-event-lanes-network-ctx-none-emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event();
      })
      .build();

    const app = r
      .resource("tests-event-lanes-network-ctx-none-app")
      .register([
        allowedContext,
        blockedContext,
        event,
        hook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          mode: "network",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await allowedContext.provide({ value: "A" }, async () =>
      blockedContext.provide({ value: "B" }, async () =>
        runtime.runTask(emitTask),
      ),
    );
    await waitUntil(() => seen.allowed !== "pending");

    expect(seen).toEqual({
      allowed: "missing",
      blocked: "missing",
    });

    await runtime.dispose();
  });

  it("forwards only allowlisted async contexts", async () => {
    const allowedContext = r
      .asyncContext<{
        value: string;
      }>("tests-event-lanes-network-ctx-allowlisted-allowed")
      .build();
    const blockedContext = r
      .asyncContext<{
        value: string;
      }>("tests-event-lanes-network-ctx-allowlisted-blocked")
      .build();
    const lane = r
      .eventLane("tests-event-lanes-network-ctx-allowlisted")
      .asyncContexts([allowedContext.id])
      .build();
    const queue = new MemoryEventLaneQueue();
    const enqueueSpy = jest.spyOn(queue, "enqueue");
    const event = r
      .event("tests-event-lanes-network-ctx-allowlisted-event")
      .tags([tags.eventLane.with({ lane })])
      .build();
    const seen = {
      allowed: "pending",
      blocked: "pending",
    };
    const hook = r
      .hook("tests-event-lanes-network-ctx-allowlisted-hook")
      .on(event)
      .run(async () => {
        seen.allowed = readContextValue(allowedContext);
        seen.blocked = readContextValue(blockedContext);
      })
      .build();
    const emitTask = r
      .task("tests-event-lanes-network-ctx-allowlisted-emit")
      .dependencies({ event })
      .run(async (_input, deps) => {
        await deps.event();
      })
      .build();

    const app = r
      .resource("tests-event-lanes-network-ctx-allowlisted-app")
      .register([
        allowedContext,
        blockedContext,
        event,
        hook,
        emitTask,
        eventLanesResource.with({
          profile: "worker",
          mode: "network",
          topology: {
            profiles: { worker: { consume: [lane] } },
            bindings: [{ lane, queue }],
          },
        }),
      ])
      .build();

    const runtime = await run(app);
    await allowedContext.provide({ value: "A" }, async () =>
      blockedContext.provide({ value: "B" }, async () =>
        runtime.runTask(emitTask),
      ),
    );
    const serializedAsyncContexts = JSON.parse(
      enqueueSpy.mock.calls[0]?.[0]?.serializedAsyncContexts ?? "{}",
    ) as Record<string, string>;
    expect(Object.values(serializedAsyncContexts)).toContain(
      allowedContext.serialize({ value: "A" }),
    );
    expect(Object.values(serializedAsyncContexts)).not.toContain(
      blockedContext.serialize({ value: "B" }),
    );
    await waitUntil(() => seen.allowed !== "pending");

    expect(seen).toEqual({
      allowed: "A",
      blocked: "missing",
    });

    await runtime.dispose();
  });
});
