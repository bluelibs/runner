import { defineResource } from "../../define";
import { DependencyProcessor } from "../../models/DependencyProcessor";
import { createTestFixture } from "../test-utils";

describe("DependencyProcessor lazy shutdown regressions", () => {
  it("rejects a lazy initialization that crosses into shutdown before ready", async () => {
    let releaseInit!: () => void;
    const initGate = new Promise<void>((resolve) => {
      releaseInit = resolve;
    });
    let initStarted = false;
    const ready = jest.fn(async () => undefined);
    const dispose = jest.fn(async () => undefined);

    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const lazyResource = defineResource({
      id: "dependency-processor-lazy-shutdown-resource",
      async init() {
        initStarted = true;
        await initGate;
        return "lazy";
      },
      ready,
      dispose,
    });

    store.storeGenericItem(lazyResource);
    store.lock();

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
    );

    const wakeupPromise = processor.extractResourceDependency(lazyResource);

    while (!initStarted) {
      await Promise.resolve();
    }

    store.beginCoolingDown();
    releaseInit();

    await expect(wakeupPromise).rejects.toThrow(
      /cannot be lazy-initialized because shutdown has already started/i,
    );
    expect(ready).toHaveBeenCalledTimes(0);
    // The value was already committed before the shutdown-admission rejection,
    // so it must be disposed here rather than silently leaked by the reset.
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(
      "lazy",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("disposes an initialized value when ready() throws during a lazy wakeup", async () => {
    const ready = jest.fn(async () => {
      throw new Error("ready exploded");
    });
    const dispose = jest.fn(async () => undefined);

    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const lazyResource = defineResource({
      id: "dependency-processor-lazy-ready-failure-resource",
      async init() {
        return "lazy";
      },
      ready,
      dispose,
    });

    store.storeGenericItem(lazyResource);
    store.lock();

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
    );

    await expect(
      processor.extractResourceDependency(lazyResource),
    ).rejects.toThrow(/ready exploded/);

    expect(ready).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(
      "lazy",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("preserves the original error when dispose throws after a failed lazy wakeup", async () => {
    const ready = jest.fn(async () => {
      throw new Error("ready exploded");
    });
    const dispose = jest.fn(async () => {
      throw new Error("dispose exploded");
    });

    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const lazyResource = defineResource({
      id: "dependency-processor-lazy-ready-dispose-failure-resource",
      async init() {
        return "lazy";
      },
      ready,
      dispose,
    });

    store.storeGenericItem(lazyResource);
    store.lock();

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
    );

    await expect(
      processor.extractResourceDependency(lazyResource),
    ).rejects.toThrow(/ready exploded/);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
