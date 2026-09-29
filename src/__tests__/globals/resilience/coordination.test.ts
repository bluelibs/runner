import { r, run, middleware, Semaphore } from "../../../index";
import { resilienceResource } from "../../../globals/resilience/resource";
import type { Resilience } from "../../../globals/resilience/types";

const config = { namespace: "test", redis: "redis://unused" };
function backend(): jest.Mocked<Resilience> {
  return {
    rateLimit: jest.fn().mockRejectedValue(new Error("Redis unavailable")),
    enterCircuit: jest.fn().mockRejectedValue(new Error("Redis unavailable")),
    settleCircuit: jest.fn(),
    withPermit: jest.fn().mockRejectedValue(new Error("Redis unavailable")),
    dispose: jest.fn().mockResolvedValue(undefined),
  };
}
const policies = [
  middleware.task.rateLimit.with({
    max: 1,
    windowMs: 60_000,
    coordination: "distributed",
  }),
  middleware.task.circuitBreaker.with({ coordination: "distributed" }),
  middleware.task.concurrency.with({ limit: 1, coordination: "distributed" }),
];

it.each(policies)("requires resilience at startup for $id", async (policy) => {
  const handler = jest.fn(async () => "ok");
  const task = r.task("task").middleware([policy]).run(handler).build();
  await expect(run(r.resource("app").register([task]).build())).rejects.toThrow(
    /resilience/i,
  );
  expect(handler).not.toHaveBeenCalled();
});

it("checks distributed requirements even when local configuration is registered first", async () => {
  const local = r
    .task("local")
    .middleware([
      middleware.task.rateLimit.with({
        max: 1,
        windowMs: 1000,
        coordination: "local",
      }),
    ])
    .run(async () => 1)
    .build();
  const remote = r
    .task("remote")
    .middleware([policies[0]])
    .run(async () => 1)
    .build();
  await expect(
    run(r.resource("app").register([local, remote]).build()),
  ).rejects.toThrow(/resilience/i);
});

it("rejects distributed coordination with an explicit semaphore", async () => {
  const task = r
    .task("task")
    .middleware([
      middleware.task.concurrency.with({
        semaphore: new Semaphore(1),
        coordination: "distributed",
      }),
    ])
    .run(async () => 1)
    .build();
  await expect(run(r.resource("app").register([task]).build())).rejects.toThrow(
    /semaphore.*local coordination/,
  );
});

it("validates coordination values on all three middleware", () => {
  expect(() =>
    middleware.task.rateLimit.with({
      max: 1,
      windowMs: 1000,
      // @ts-expect-error Unknown coordination modes must also fail at runtime.
      coordination: "redis",
    }),
  ).toThrow();
  expect(() =>
    middleware.task.circuitBreaker.with({
      // @ts-expect-error Unknown coordination modes must also fail at runtime.
      coordination: "redis",
    }),
  ).toThrow();
  expect(() =>
    middleware.task.concurrency.with({
      limit: 1,
      // @ts-expect-error Unknown coordination modes must also fail at runtime.
      coordination: "redis",
    }),
  ).toThrow();
});

it("uses local policies despite an unavailable registered backend", async () => {
  const shared = backend();
  const task = r
    .task("local")
    .middleware([
      middleware.task.rateLimit.with({
        max: 1,
        windowMs: 60_000,
        coordination: "local",
      }),
      middleware.task.circuitBreaker.with({ coordination: "local" }),
      middleware.task.concurrency.with({ limit: 1, coordination: "local" }),
    ])
    .run(async () => "ok")
    .build();
  const explicit = r
    .task("semaphore")
    .middleware([
      middleware.task.concurrency.with({ semaphore: new Semaphore(1) }),
    ])
    .run(async () => "ok")
    .build();
  const runtime = await run(
    r
      .resource("app")
      .register([task, explicit, resilienceResource.with(config)])
      .overrides([r.override(resilienceResource, async () => shared)])
      .build(),
  );
  try {
    await expect(runtime.runTask(task)).resolves.toBe("ok");
    await expect(runtime.runTask(task)).rejects.toThrow(/Rate limit exceeded/);
    await expect(runtime.runTask(explicit)).resolves.toBe("ok");
    expect(shared.rateLimit).not.toHaveBeenCalled();
    expect(shared.enterCircuit).not.toHaveBeenCalled();
    expect(shared.withPermit).not.toHaveBeenCalled();
  } finally {
    await runtime.dispose();
  }
});

it.each(policies)(
  "requires resilience for subtree $id policies",
  async (policy) => {
    const task = r
      .task("task")
      .run(async () => "ok")
      .build();
    const app = r
      .resource("app")
      .register([task])
      .subtree({ tasks: { middleware: [policy] } })
      .build();
    await expect(run(app)).rejects.toThrow(/resilience/i);
  },
);

it("allows unrelated middleware to use its own coordination option", async () => {
  const unrelated = r.middleware
    .task<{ coordination: string }>("custom")
    .run(async ({ task, next }) => next(task.input))
    .build();
  const task = r
    .task("task")
    .middleware([unrelated.with({ coordination: "distributed" })])
    .run(async () => "ok")
    .build();
  const runtime = await run(
    r.resource("app").register([task, unrelated]).build(),
  );
  try {
    await expect(runtime.runTask(task)).resolves.toBe("ok");
  } finally {
    await runtime.dispose();
  }
});

it.each(policies)(
  "propagates backend failure for explicit distributed $id",
  async (policy) => {
    const handler = jest.fn(async () => "ok");
    const task = r.task("task").middleware([policy]).run(handler).build();
    const runtime = await run(
      r
        .resource("app")
        .register([task, resilienceResource.with(config)])
        .overrides([r.override(resilienceResource, async () => backend())])
        .build(),
    );
    try {
      await expect(runtime.runTask(task)).rejects.toThrow("Redis unavailable");
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  },
);
