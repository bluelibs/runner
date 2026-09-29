import { resilienceError } from "../../../errors";
import { r, run, middleware, resources } from "../../../index";
import { resilienceResource } from "../../../globals/resilience/resource";
import type { Resilience } from "../../../globals/resilience/types";
import { Semaphore } from "../../../models/Semaphore";
import { journal } from "../../../models/ExecutionJournal";

function backend(): jest.Mocked<Resilience> {
  return {
    rateLimit: jest
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 1, resetTime: 1000 }),
    enterCircuit: jest.fn().mockResolvedValue({
      allowed: true,
      state: "CLOSED",
      failures: 0,
      generation: "a",
    }),
    settleCircuit: jest
      .fn()
      .mockResolvedValue({ state: "CLOSED", failures: 0 }),
    withPermit: jest.fn(async (_key, _limit, _signal, _abort, work) =>
      work(),
    ) as jest.Mocked<Resilience>["withPermit"],
    dispose: jest.fn().mockResolvedValue(undefined),
  };
}

const config = { namespace: "test", redis: "redis://localhost" };

describe("optional resilience middleware integration", () => {
  it("does not register the optional resource, preserving per-runtime memory isolation", async () => {
    const task = r
      .task("limited")
      .middleware([middleware.task.rateLimit.with({ max: 1, windowMs: 1000 })])
      .run(async () => "ok")
      .build();
    const app = r.resource("app").register([task]).build();
    const first = await run(app);
    const second = await run(app);
    try {
      await expect(first.runTask(task)).resolves.toBe("ok");
      await expect(first.runTask(task)).rejects.toThrow(/Rate limit/);
      await expect(second.runTask(task)).resolves.toBe("ok");
      expect(
        first.getResourceValue(resources.rateLimit).resilience,
      ).toBeUndefined();
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it("uses the portable dependency identity, reports journals and propagates failures", async () => {
    const shared = backend();
    const task = r
      .task("limited")
      .middleware([middleware.task.rateLimit.with({ max: 2, windowMs: 1000 })])
      .run(async () => "ok")
      .build();
    const app = r
      .resource("app")
      .register([task, resilienceResource.with(config)])
      .overrides([r.override(resilienceResource, async () => shared)])
      .build();
    const runtime = await run(app);
    const executionJournal = journal.create();
    try {
      await expect(
        runtime.runTask(task, undefined, { journal: executionJournal }),
      ).resolves.toBe("ok");
      expect(shared.rateLimit).toHaveBeenCalledWith(
        "app.tasks.limited",
        expect.any(String),
        2,
        1000,
        undefined,
      );
      expect(
        executionJournal.get(middleware.task.rateLimit.journalKeys.remaining),
      ).toBe(1);
      shared.rateLimit.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetTime: 1000,
      });
      await expect(runtime.runTask(task)).rejects.toThrow(
        /Rate limit exceeded/,
      );
      shared.rateLimit.mockRejectedValueOnce(new Error("Redis down"));
      await expect(runtime.runTask(task)).rejects.toThrow("Redis down");
    } finally {
      await runtime.dispose();
    }
    expect(shared.dispose).toHaveBeenCalledTimes(1);
  });

  it("records successful and failed circuit calls and rejects open circuits", async () => {
    const shared = backend();
    const handler = jest.fn().mockResolvedValue("ok");
    const task = r
      .task("circuit")
      .middleware([middleware.task.circuitBreaker])
      .run(handler)
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([task, resilienceResource.with(config)])
        .overrides([r.override(resilienceResource, async () => shared)])
        .build(),
    );
    try {
      await expect(runtime.runTask(task)).resolves.toBe("ok");
      expect(shared.settleCircuit).toHaveBeenLastCalledWith(
        "app.tasks.circuit",
        expect.any(Object),
        true,
      );
      handler.mockRejectedValueOnce(new Error("failed"));
      await expect(runtime.runTask(task)).rejects.toThrow("failed");
      expect(shared.settleCircuit).toHaveBeenLastCalledWith(
        "app.tasks.circuit",
        expect.any(Object),
        false,
      );
      shared.enterCircuit.mockResolvedValueOnce({
        allowed: false,
        state: "HALF_OPEN",
        failures: 5,
        generation: "a",
      });
      await expect(runtime.runTask(task)).rejects.toThrow(/HALF_OPEN/);
      shared.settleCircuit.mockRejectedValueOnce(
        new Error("Redis unavailable"),
      );
      await expect(runtime.runTask(task)).rejects.toThrow("Redis unavailable");
      expect(shared.settleCircuit).toHaveBeenCalledTimes(3);
    } finally {
      await runtime.dispose();
    }
  });

  it("selects task or explicitly shared concurrency identities and aborts on lease loss", async () => {
    const shared = backend();
    const task = r
      .task("limited")
      .middleware([middleware.task.concurrency.with({ limit: 1 })])
      .run(async () => "ok")
      .build();
    const grouped = r
      .task("grouped")
      .middleware([
        middleware.task.concurrency.with({ limit: 1, key: "payments" }),
      ])
      .run(async () => "ok")
      .build();
    const local = r
      .task("local")
      .middleware([
        middleware.task.concurrency.with({ semaphore: new Semaphore(1) }),
      ])
      .run(async () => "ok")
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([task, grouped, local, resilienceResource.with(config)])
        .overrides([r.override(resilienceResource, async () => shared)])
        .build(),
    );
    try {
      await runtime.runTask(task);
      await runtime.runTask(grouped);
      expect(
        JSON.parse(shared.withPermit.mock.calls[0][0]).slice(0, 2),
      ).toEqual(["task", "app.tasks.limited"]);
      expect(
        JSON.parse(shared.withPermit.mock.calls[1][0]).slice(0, 2),
      ).toEqual(["shared", "payments"]);
      await expect(runtime.runTask(local)).rejects.toThrow(
        /Explicit local semaphores/,
      );
      shared.withPermit.mockImplementationOnce(
        async (_key, _limit, signal, abort) => {
          abort(new Error("lease lost"));
          expect(signal?.aborted).toBe(true);
          throw new Error("lease lost");
        },
      );
      await expect(runtime.runTask(task)).rejects.toThrow("lease lost");
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects portable initialization and invalid Redis configuration", async () => {
    expect(resilienceError.id).toBe("resilience");
    expect(() =>
      resilienceResource.with({ ...config, namespace: "" }),
    ).toThrow();
    await expect(
      run(
        r
          .resource("app")
          .register([resilienceResource.with(config)])
          .build(),
      ),
    ).rejects.toThrow(/Node entry point/);
  });
});
