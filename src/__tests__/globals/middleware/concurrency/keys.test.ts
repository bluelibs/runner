import { r, run, middleware, asyncContexts } from "../../../../index";
import {
  assertConcurrencyConfig,
  resolveConcurrencyKey,
} from "../../../../globals/middleware/concurrency/config";
import { Semaphore } from "../../../../models/Semaphore";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe("dynamic concurrency keys", () => {
  it("shares matching static/dynamic keys and separates different inputs", async () => {
    const entered = gate();
    const release = gate();
    const builder = jest.fn((_id: string, input: unknown) => String(input));
    const dynamic = r
      .task("dynamic")
      .middleware([
        middleware.task.concurrency.with({
          limit: 1,
          maxQueue: 0,
          keyBuilder: builder,
        }),
      ])
      .run(async (input: string) => {
        if (input === "shared") {
          entered.open();
          await release.promise;
        }
        return input;
      })
      .build();
    const fixed = r
      .task("fixed")
      .middleware([
        middleware.task.concurrency.with({
          limit: 1,
          maxQueue: 0,
          key: "shared",
        }),
      ])
      .run(async () => "ok")
      .build();
    const runtime = await run(
      r.resource("app").register([dynamic, fixed]).build(),
    );
    const held = runtime.runTask(dynamic, "shared");
    try {
      await entered.promise;
      await expect(runtime.runTask(fixed)).rejects.toThrow(/queue is full/);
      await expect(runtime.runTask(dynamic, "different:key")).resolves.toBe(
        "different:key",
      );
      expect(builder).toHaveBeenCalledWith("app.tasks.dynamic", "shared");
    } finally {
      release.open();
      await held;
      await runtime.dispose();
    }
  });

  it("applies tenant identity after key building and avoids separator collisions", async () => {
    const entered = gate();
    const release = gate();
    const task = r
      .task("keyed")
      .middleware([
        middleware.task.concurrency.with({
          limit: 1,
          maxQueue: 0,
          keyBuilder: (_id, input) => String(input),
          identityScope: { tenant: true, user: true, required: true },
        }),
      ])
      .run(async (input: string) => {
        if (input === "c:d") {
          entered.open();
          await release.promise;
        }
        return input;
      })
      .build();
    const runtime = await run(r.resource("app").register([task]).build());
    const held = asyncContexts.identity.provide(
      { region: "eu", tenantId: "a", userId: "b" },
      () => runtime.runTask(task, "c:d"),
    );
    try {
      await entered.promise;
      await expect(
        asyncContexts.identity.provide(
          { region: "eu", tenantId: "a", userId: "b" },
          () => runtime.runTask(task, "c:d"),
        ),
      ).rejects.toThrow(/queue is full/);
      await expect(
        asyncContexts.identity.provide(
          { region: "eu", tenantId: "a", userId: "c" },
          () => runtime.runTask(task, "b:d"),
        ),
      ).resolves.toBe("b:d");
      await expect(runtime.runTask(task, "x")).rejects.toThrow();
    } finally {
      release.open();
      await held;
      await runtime.dispose();
    }
  });

  it("forwards caller cancellation through the middleware's local queue", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();
    const task = r
      .task("waiting")
      .middleware([
        middleware.task.concurrency.with({ semaphore, maxQueue: 1 }),
      ])
      .run(async () => "ok")
      .build();
    const runtime = await run(r.resource("app").register([task]).build());
    const controller = new AbortController();
    const pending = runtime
      .runTask(task, undefined, { signal: controller.signal })
      .catch((error: unknown) => error);
    controller.abort();
    expect(await pending).toBeInstanceOf(Error);
    expect(semaphore.getWaitingCount()).toBe(0);
    semaphore.release();
    await runtime.dispose();
  });

  it("rejects ambiguous configurations and malformed builder results", () => {
    expect(() =>
      assertConcurrencyConfig({ limit: 1, key: "a", keyBuilder: () => "a" }),
    ).toThrow(/either key or keyBuilder/);
    expect(() => assertConcurrencyConfig({ keyBuilder: () => "a" })).toThrow(
      /requires "limit"/,
    );
    expect(() =>
      assertConcurrencyConfig({
        semaphore: new Semaphore(1),
        keyBuilder: () => "a",
      }),
    ).toThrow(/ambiguous/);
    expect(() =>
      resolveConcurrencyKey({ keyBuilder: () => "" }, "task", undefined),
    ).toThrow(/non-empty string/);
    expect(() =>
      resolveConcurrencyKey(
        { keyBuilder: () => 42 as never },
        "task",
        undefined,
      ),
    ).toThrow(/non-empty string/);
  });

  it.each([-1, 1.5, Infinity, NaN])(
    "rejects invalid queue limits and timeouts: %p",
    (value) => {
      expect(() =>
        middleware.task.concurrency.with({ limit: 1, maxQueue: value }),
      ).toThrow();
      expect(() =>
        middleware.task.concurrency.with({ limit: 1, waitTimeoutMs: value }),
      ).toThrow();
    },
  );

  it("rejects timer values that would overflow native timers", () => {
    expect(() =>
      middleware.task.concurrency.with({
        limit: 1,
        waitTimeoutMs: 2_147_483_648,
      }),
    ).toThrow();
  });
});
