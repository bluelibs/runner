import { defineResource } from "../../define";
import { DependencyProcessor } from "../../models/DependencyProcessor";
import { ResourceInitMode } from "../../types/runner";
import { createTestFixture } from "../test-utils";

describe("DependencyProcessor parallel init internals", () => {
  it("throws when no pending resource is ready for a parallel wave", async () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const missing = defineResource({
      id: "parallel.wave.missing.dep",
    });
    const pending = defineResource({
      id: "parallel.wave.pending",
      dependencies: { missing },
      async init() {
        return "pending";
      },
    });

    store.storeGenericItem(pending);
    store.root = {
      resource: defineResource({ id: "parallel.wave.root" }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as any;

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceInitMode.Parallel,
    ) as any;

    await expect(
      processor.initializeUninitializedResourcesParallel(),
    ).rejects.toThrow(
      "Could not schedule pending resources for initialization in parallel mode.",
    );
  });

  it("normalizes non-Error parallel init rejections into Error and throws single failure directly", async () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const first = defineResource({
      id: "parallel.wave.first",
      async init() {
        return "first";
      },
    });
    const second = defineResource({
      id: "parallel.wave.second",
      async init() {
        return "second";
      },
    });

    store.storeGenericItem(first);
    store.storeGenericItem(second);
    store.root = {
      resource: defineResource({ id: "parallel.wave.root.2" }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as any;

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceInitMode.Parallel,
    ) as any;

    jest
      .spyOn(processor, "ensureResourceInitialized")
      .mockImplementation(async (resource: any) => {
        if (resource.resource.id === first.id) {
          throw "non-error rejection";
        }
        resource.isInitialized = true;
      });

    let caught: unknown;
    try {
      await processor.initializeUninitializedResourcesParallel();
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("non-error rejection");
  });
});
