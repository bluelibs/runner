import { r } from "../../../";
import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { rateLimitTaskMiddleware } from "../../../globals/middleware/rateLimit.middleware";
import {
  debounceTaskMiddleware,
  throttleTaskMiddleware,
} from "../../../globals/middleware/temporal.middleware";

describe("default keyed middleware behavior", () => {
  it("keeps full task lineage in default keys across sibling resources", async () => {
    const billingSync = defineTask({
      id: "sync",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 1_000, max: 1 })],
      run: async (input: string) => `billing:${input}`,
    });
    const crmSync = defineTask({
      id: "sync",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 1_000, max: 1 })],
      run: async (input: string) => `crm:${input}`,
    });
    const app = defineResource({
      id: "app",
      register: [
        r.resource("billing").register([billingSync]).build(),
        r.resource("crm").register([crmSync]).build(),
      ],
    });

    const runtime = await run(app);

    try {
      await expect(
        runtime.runTask("app.billing.tasks.sync", "same"),
      ).resolves.toBe("billing:same");
      await expect(runtime.runTask("app.crm.tasks.sync", "same")).resolves.toBe(
        "crm:same",
      );
      await expect(
        runtime.runTask("app.billing.tasks.sync", "same"),
      ).rejects.toThrow(/rate limit exceeded/i);
      await expect(
        runtime.runTask("app.crm.tasks.sync", "same"),
      ).rejects.toThrow(/rate limit exceeded/i);
    } finally {
      await runtime.dispose();
    }
  });

  it("isolates rate limits per serialized input by default", async () => {
    const task = defineTask({
      id: "rateLimit-default-input-aware",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 1_000, max: 1 })],
      run: async (input: string) => input,
    });

    const app = defineResource({
      id: "app-rateLimit-default-input-aware",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await expect(task("a")).resolves.toBe("a");
        await expect(task("b")).resolves.toBe("b");
        await expect(task("a")).rejects.toThrow(/rate limit exceeded/i);
      },
    });

    await run(app);
  });

  it("debounces only matching serialized inputs by default", async () => {
    jest.useFakeTimers();
    let callCount = 0;

    const task = defineTask({
      id: "debounce-default-input-aware",
      middleware: [debounceTaskMiddleware.with({ ms: 50 })],
      run: async (input: string) => {
        callCount += 1;
        return input;
      },
    });

    const app = defineResource({
      id: "app-debounce-default-input-aware",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        const pending = Promise.all([task("a"), task("b")]);
        jest.advanceTimersByTime(50);
        await Promise.resolve();
        return pending;
      },
    });

    try {
      const results = (await run(app)).value;
      expect(results).toEqual(["a", "b"]);
      expect(callCount).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("throttles only matching serialized inputs by default", async () => {
    let callCount = 0;

    const task = defineTask({
      id: "throttle-default-input-aware",
      middleware: [throttleTaskMiddleware.with({ ms: 50 })],
      run: async (input: string) => {
        callCount += 1;
        return input;
      },
    });

    const app = defineResource({
      id: "app-throttle-default-input-aware",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        return await Promise.all([task("a"), task("b")]);
      },
    });

    const results = (await run(app)).value;
    expect(results).toEqual(["a", "b"]);
    expect(callCount).toBe(2);
  });
});
