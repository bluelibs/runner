import { defineResource } from "../../define";
import { createTestFixture } from "../test-utils";
import { createMessageError } from "../../errors";

describe("Store disposal regressions", () => {
  it("continues disposing resources after a disposer throws", async () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    store.setTaskRunner(fixture.createTaskRunner());

    const disposeOrder: string[] = [];

    const safeResource = defineResource({
      id: "store.dispose.safe",
      async dispose() {
        disposeOrder.push("safe");
      },
    });

    const failingResource = defineResource({
      id: "store.dispose.failing",
      async dispose() {
        disposeOrder.push("failing");
        throw createMessageError("failing dispose");
      },
    });

    store.storeGenericItem(safeResource);
    store.storeGenericItem(failingResource);

    store.resources.get(safeResource.id)!.isInitialized = true;
    store.resources.get(failingResource.id)!.isInitialized = true;

    store.recordResourceInitialized(safeResource.id);
    store.recordResourceInitialized(failingResource.id);

    await expect(store.dispose()).rejects.toThrow("failing dispose");
    expect(disposeOrder).toEqual(["failing", "safe"]);
  });

  it("clears resource runtime references after disposal", async () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    store.setTaskRunner(fixture.createTaskRunner());

    const resource = defineResource({
      id: "store.dispose.cleanup",
      async dispose() {
        return;
      },
    });

    store.storeGenericItem(resource);

    const entry = store.resources.get(resource.id)!;
    entry.value = { socket: { connected: true } } as any;
    entry.context = { tx: "active" } as any;
    entry.computedDependencies = { dep: "value" } as any;
    entry.isInitialized = true;
    store.recordResourceInitialized(resource.id);

    await store.dispose();

    expect(entry.value).toBeUndefined();
    expect(entry.context).toBeUndefined();
    expect(entry.computedDependencies).toBeUndefined();
    expect(entry.isInitialized).toBe(false);
  });

  it("aggregates multiple disposal failures and normalizes non-Error throws", async () => {
    expect.assertions(5);

    const fixture = createTestFixture();
    const { store } = fixture;
    store.setTaskRunner(fixture.createTaskRunner());

    const stringThrowingResource = defineResource({
      id: "store.dispose.string.failure",
      async dispose() {
        throw "string failure";
      },
    });

    const errorThrowingResource = defineResource({
      id: "store.dispose.error.failure",
      async dispose() {
        throw createMessageError("error failure");
      },
    });

    store.storeGenericItem(stringThrowingResource);
    store.storeGenericItem(errorThrowingResource);

    store.resources.get(stringThrowingResource.id)!.isInitialized = true;
    store.resources.get(errorThrowingResource.id)!.isInitialized = true;

    store.recordResourceInitialized(stringThrowingResource.id);
    store.recordResourceInitialized(errorThrowingResource.id);

    let caught: unknown;
    try {
      await store.dispose();
    } catch (error) {
      caught = error;
    }

    const aggregateError = caught as Error & {
      name: string;
      errors: Error[];
    };
    expect(aggregateError.name).toBe("AggregateError");
    expect(aggregateError.errors).toHaveLength(2);
    expect(aggregateError.errors[0]).toBeInstanceOf(Error);
    expect(aggregateError.errors[1]).toBeInstanceOf(Error);
    expect(aggregateError.errors.map((error: Error) => error.message)).toEqual(
      expect.arrayContaining(["string failure", "error failure"]),
    );
  });
});
