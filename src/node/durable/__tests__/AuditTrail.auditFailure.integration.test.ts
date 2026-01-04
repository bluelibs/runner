import { r, run } from "../../..";
import { durableResource } from "../core/resource";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryStore } from "../store/MemoryStore";

describe("durable: audit trail failure tolerance (integration)", () => {
  it("does not break execution when audit persistence fails", async () => {
    class ThrowingAuditStore extends MemoryStore {
      override async appendAuditEntry(): Promise<void> {
        throw new Error("audit-down");
      }
    }

    const store = new ThrowingAuditStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable.tests.audit.failure.durable");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      audit: { enabled: true },
      polling: { interval: 5 },
    });

    const task = r
      .task("durable.test.audit.failure")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.note("hello");
        return await ctx.step("s1", async () => "ok");
      })
      .build();

    const app = r.resource("app").register([durableRegistration, task]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    await expect(service.execute(task, undefined, { timeout: 5_000 })).resolves.toBe(
      "ok",
    );

    await runtime.dispose();
  });
});
