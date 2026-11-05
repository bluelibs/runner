import { SuspensionSignal } from "../../../../durable/core/interfaces/context";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { gate, stepFixture } from "./stepConcurrency.helpers";

describe("durable: step concurrency", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("coordinates numeric caps across contexts and derives the persisted workflow/step pool", async () => {
    const store = new MemoryStore();
    const first = await stepFixture({ store, executionId: "first" });
    const second = await stepFixture({ store, executionId: "second" });
    const entered = gate();
    const finish = gate();
    const held = first.ctx.step("charge", { concurrency: 1 }, async () => {
      entered.open();
      await finish.promise;
      return 42;
    });
    await entered.promise;
    const blocked = jest.fn(async () => 1);
    await expect(
      second.ctx.step("charge", { concurrency: { limit: 1 } }, blocked),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(blocked).not.toHaveBeenCalled();
    expect(await store.getReadyTimers(new Date(Date.now() + 1000))).toEqual([
      expect.objectContaining({ executionId: "second", type: "retry" }),
    ]);
    finish.open();
    await expect(held).resolves.toBe(42);
    await expect(
      second.replay().step("charge", { concurrency: 1 }, blocked),
    ).resolves.toBe(1);
  });

  it("lets selected steps in different workflows share an explicit pool", async () => {
    const store = new MemoryStore();
    const first = await stepFixture({
      store,
      executionId: "first",
      workflowKey: "orders",
    });
    const second = await stepFixture({
      store,
      executionId: "second",
      workflowKey: "invoices",
    });
    const entered = gate();
    const finish = gate();
    const concurrency = { key: "payments.charge", limit: 1 };
    const held = first.ctx.step("charge-order", { concurrency }, async () => {
      entered.open();
      await finish.promise;
    });
    await entered.promise;
    try {
      await expect(
        second.ctx.step("charge-invoice", { concurrency }, async () => 1),
      ).rejects.toThrow("step-concurrency");
    } finally {
      finish.open();
      await held;
    }
  });

  it("keeps default workflow/step tuples and explicit keys collision-free", async () => {
    const store = new MemoryStore();
    const first = await stepFixture({
      store,
      executionId: "first",
      workflowKey: "a:b",
    });
    const second = await stepFixture({
      store,
      executionId: "second",
      workflowKey: "a",
    });
    const entered = gate();
    const finish = gate();
    const held = first.ctx.step("c", { concurrency: 1 }, async () => {
      entered.open();
      await finish.promise;
    });
    await entered.promise;
    try {
      await expect(
        second.ctx.step("b:c", { concurrency: 1 }, async () => "independent"),
      ).resolves.toBe("independent");
      const third = await stepFixture({
        store,
        executionId: "third",
        workflowKey: "a:b",
      });
      await expect(
        third.ctx.step(
          "c",
          { concurrency: { key: '["workflow","a:b","c"]', limit: 1 } },
          async () => "explicit",
        ),
      ).resolves.toBe("explicit");
    } finally {
      finish.open();
      await held;
    }
  });

  it("returns a cached result without acquiring a permit or consuming rate allowance", async () => {
    const { ctx, replay, store } = await stepFixture();
    const concurrency = { windowMs: 1000, max: 1 };
    await expect(
      ctx.step("charge", { concurrency }, async () => 42),
    ).resolves.toBe(42);
    const acquire = jest.spyOn(store, "acquireLock");
    const body = jest.fn(async () => 0);
    await expect(replay().step("charge", { concurrency }, body)).resolves.toBe(
      42,
    );
    expect(acquire).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
  });

  it("reacquires admission for each callback retry and releases during backoff", async () => {
    jest.useFakeTimers();
    const { ctx, store } = await stepFixture();
    const acquire = jest.spyOn(store, "acquireLock");
    const release = jest.spyOn(store, "releaseLock");
    const body = jest
      .fn()
      .mockRejectedValueOnce(new Error("retry me"))
      .mockResolvedValueOnce(42);
    const pending = ctx.step("charge", { concurrency: 1, retries: 1 }, body);
    await jest.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBe(42);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("consumes fixed-window starts on failed retries and admits again in the next window", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.250Z"));
    const { ctx, replay, store } = await stepFixture();
    const release = jest.spyOn(store, "releaseLock");
    const concurrency = { key: "provider", windowMs: 1000, max: 1 };
    const body = jest
      .fn()
      .mockRejectedValueOnce(new Error("retry me"))
      .mockResolvedValueOnce(42);
    const failure = ctx
      .step("charge", { concurrency, retries: 1 }, body)
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(200);
    expect(await failure).toBeInstanceOf(SuspensionSignal);
    expect(body).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(
      await store.getReadyTimers(new Date("2026-01-01T00:00:01.000Z")),
    ).toEqual([
      expect.objectContaining({ fireAt: new Date("2026-01-01T00:00:01.000Z") }),
    ]);
    await jest.advanceTimersByTimeAsync(550);
    await expect(replay().step("charge", { concurrency }, body)).resolves.toBe(
      42,
    );
  });
});

it("permits two live callbacks with a cap of two and parks the third", async () => {
  const store = new MemoryStore();
  const first = await stepFixture({ store, executionId: "one" });
  const second = await stepFixture({ store, executionId: "two" });
  const third = await stepFixture({ store, executionId: "three" });
  const entered = [gate(), gate()];
  const finish = gate();
  const held = [first, second].map((fixture, index) =>
    fixture.ctx.step("charge", { concurrency: 2 }, async () => {
      entered[index].open();
      await finish.promise;
      return index;
    }),
  );
  await Promise.all(entered.map((value) => value.promise));
  try {
    await expect(
      third.ctx.step("charge", { concurrency: 2 }, async () => 42),
    ).rejects.toThrow("step-concurrency");
  } finally {
    finish.open();
    await Promise.all(held);
  }
  await expect(
    third.replay().step("charge", { concurrency: 2 }, async () => 42),
  ).resolves.toBe(42);
});

it("snapshots caller-owned concurrency options before asynchronous acquisition", async () => {
  const { ctx, store } = await stepFixture();
  const acquire = jest.spyOn(store, "acquireLock");
  const concurrency = { key: "original", limit: 1 };
  const pending = ctx.step("charge", { concurrency }, async () => 42);
  concurrency.key = "changed";
  concurrency.limit = 3;
  await expect(pending).resolves.toBe(42);
  expect(acquire).toHaveBeenCalledWith(
    `step-admission:concurrency:${encodeURIComponent(JSON.stringify(["shared", "original"]))}:0`,
    30000,
  );
});

it("keeps matching named pools isolated when their durable stores are independent", async () => {
  const first = await stepFixture();
  const second = await stepFixture();
  const entered = gate();
  const finish = gate();
  const concurrency = { key: "same-name", limit: 1 };
  const held = first.ctx.step("charge", { concurrency }, async () => {
    entered.open();
    await finish.promise;
  });
  await entered.promise;
  try {
    await expect(
      second.ctx.step("charge", { concurrency }, async () => 42),
    ).resolves.toBe(42);
  } finally {
    finish.open();
    await held;
  }
});
