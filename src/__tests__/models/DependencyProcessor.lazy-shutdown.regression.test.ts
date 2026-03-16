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
  });
});
