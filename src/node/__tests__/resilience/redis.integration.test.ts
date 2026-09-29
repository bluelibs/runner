import { randomUUID } from "node:crypto";
import { r, resources, middleware, run } from "../../node";
import {
  RedisResilience,
  type ResilienceRedisClient,
} from "../../resilience/RedisResilience";
import { createIORedisClient } from "../../durable/optionalDeps/ioredis";

const url = process.env.RESILIENCE_REDIS_URL;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

(url ? describe : describe.skip)("Redis resilience: real coordination", () => {
  let namespace: string;
  const backends: RedisResilience[] = [];
  beforeEach(() => {
    namespace = randomUUID();
  });
  afterEach(async () => {
    await Promise.all(backends.splice(0).map((backend) => backend.dispose()));
  });
  function backend(leaseMs = 100) {
    const value = new RedisResilience(
      createIORedisClient(url) as ResilienceRedisClient,
      { namespace, redis: url!, leaseMs },
    );
    backends.push(value);
    return value;
  }

  it("automatically shares limits across runtimes and preserves state after disposal", async () => {
    const task = r
      .task("charge")
      .middleware([
        middleware.task.rateLimit.with({ max: 2, windowMs: 60_000 }),
      ])
      .run(async () => "ok")
      .build();
    const app = () =>
      r
        .resource("payments")
        .register([task, resources.resilience.with({ namespace, redis: url! })])
        .build();
    const first = await run(app());
    const second = await run(app());
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          (index % 2 ? first : second).runTask(task),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(2);
    } finally {
      await first.dispose();
      await second.dispose();
    }
    const third = await run(app());
    try {
      await expect(third.runTask(task)).rejects.toThrow(/Rate limit exceeded/);
    } finally {
      await third.dispose();
    }
  });

  it("isolates namespaces, full task identities and partitions", async () => {
    const first = backend();
    const second = backend();
    expect(
      (await first.rateLimit("a.tasks.charge", "tenant:a", 1, 1000)).allowed,
    ).toBe(true);
    expect(
      (await second.rateLimit("a.tasks.charge", "tenant:a", 1, 1000)).allowed,
    ).toBe(false);
    expect(
      (await second.rateLimit("b.tasks.charge", "tenant:a", 1, 1000)).allowed,
    ).toBe(true);
    expect(
      (await second.rateLimit("a.tasks.charge", "tenant:b", 1, 1000)).allowed,
    ).toBe(true);
    namespace = randomUUID();
    expect(
      (await backend().rateLimit("a.tasks.charge", "tenant:a", 1, 1000))
        .allowed,
    ).toBe(true);
  });

  it("enforces capacity, windows and conflicting configurations atomically", async () => {
    const value = backend();
    await value.rateLimit("task", "a", 1, 70, 1);
    await expect(value.rateLimit("task", "b", 1, 70, 1)).rejects.toThrow(
      /maxKeys/,
    );
    await expect(value.rateLimit("task", "a", 2, 70, 1)).rejects.toThrow(
      /Conflicting/,
    );
    await pause(90);
    expect((await value.rateLimit("task", "b", 1, 70, 1)).allowed).toBe(true);
  });

  it("shares circuit transitions and admits only one recovery probe", async () => {
    const first = backend();
    const second = backend();
    const admission = await first.enterCircuit("task", 1, 50);
    const stale = await second.enterCircuit("task", 1, 50);
    expect(await first.settleCircuit("task", admission, false)).toMatchObject({
      state: "OPEN",
      failures: 1,
    });
    expect(await second.settleCircuit("task", stale, true)).toMatchObject({
      state: "OPEN",
    });
    expect((await second.enterCircuit("task", 1, 50)).allowed).toBe(false);
    await pause(65);
    const probes = await Promise.all([
      first.enterCircuit("task", 1, 50),
      second.enterCircuit("task", 1, 50),
    ]);
    expect(probes.filter((probe) => probe.allowed)).toHaveLength(1);
    const probe = probes.find((entry) => entry.allowed)!;
    expect(await first.settleCircuit("task", probe, true)).toMatchObject({
      state: "CLOSED",
      failures: 0,
    });
    await expect(second.enterCircuit("task", 2, 50)).rejects.toThrow(
      /Conflicting/,
    );
  });

  it("recovers abandoned probes and rejects expired outcomes", async () => {
    const value = backend(50);
    await value.settleCircuit(
      "task",
      await value.enterCircuit("task", 1, 10),
      false,
    );
    await pause(20);
    const abandoned = await value.enterCircuit("task", 1, 10);
    await pause(65);
    await expect(value.settleCircuit("task", abandoned, true)).rejects.toThrow(
      /lease expired/,
    );
    const recovered = await value.enterCircuit("task", 1, 10);
    expect(recovered.allowed).toBe(true);
    expect(recovered.generation).not.toBe(abandoned.generation);
    expect(await value.settleCircuit("task", recovered, false)).toMatchObject({
      state: "OPEN",
    });
  });

  it("coordinates renewable permits across runtimes", async () => {
    const first = backend(150);
    const second = backend(150);
    let active = 0;
    let peak = 0;
    const work = async () => {
      active++;
      peak = Math.max(peak, active);
      await pause(220);
      active--;
      return "ok";
    };
    const abort = jest.fn();
    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        (index % 2 ? first : second).withPermit(
          "shared",
          1,
          undefined,
          abort,
          work,
        ),
      ),
    );
    expect(peak).toBe(1);
    expect(abort).not.toHaveBeenCalled();
  });

  it("automatically coordinates middleware circuits and concurrency", async () => {
    let active = 0;
    let peak = 0;
    const limited = r
      .task("limited")
      .middleware([
        middleware.task.concurrency.with({ limit: 1, key: "shared" }),
      ])
      .run(async () => {
        active++;
        peak = Math.max(peak, active);
        await pause(30);
        active--;
      })
      .build();
    const broken = r
      .task("broken")
      .middleware([
        middleware.task.circuitBreaker.with({ failureThreshold: 1 }),
      ])
      .run(async () => {
        throw new Error("dependency failed");
      })
      .build();
    const app = () =>
      r
        .resource("app")
        .register([
          limited,
          broken,
          resources.resilience.with({ namespace, redis: url! }),
        ])
        .build();
    const first = await run(app());
    const second = await run(app());
    try {
      await Promise.all([first.runTask(limited), second.runTask(limited)]);
      expect(peak).toBe(1);
      await expect(first.runTask(broken)).rejects.toThrow("dependency failed");
      await expect(second.runTask(broken)).rejects.toThrow(/Circuit is OPEN/);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
  it("rejects incompatible shared lease policies and missing circuit state", async () => {
    const first = backend(500);
    const second = backend(1000);
    await first.enterCircuit("policy", 1, 100);
    await expect(second.enterCircuit("policy", 1, 100)).rejects.toThrow(
      /Conflicting/,
    );
    await expect(
      first.settleCircuit(
        "missing",
        { allowed: true, state: "CLOSED", failures: 0, generation: "missing" },
        true,
      ),
    ).rejects.toThrow(/state was lost/);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = first.withPermit("policy", 1, undefined, jest.fn(), () => {
      entered();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await ready;
    try {
      await expect(
        second.withPermit("policy", 1, undefined, jest.fn(), async () => {}),
      ).rejects.toThrow(/Conflicting/);
      await expect(
        first.withPermit("policy", 2, undefined, jest.fn(), async () => {}),
      ).rejects.toThrow(/Conflicting/);
    } finally {
      release();
      await held;
    }
  });
});
