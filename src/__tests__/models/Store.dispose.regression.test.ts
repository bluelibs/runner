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
      id: "store-dispose-safe",
      async dispose() {
        disposeOrder.push("safe");
      },
    });

    const failingResource = defineResource({
      id: "store-dispose-failing",
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
      id: "store-dispose-cleanup",
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
      id: "store-dispose-string-failure",
      async dispose() {
        throw "string failure";
      },
    });

    const errorThrowingResource = defineResource({
      id: "store-dispose-error-failure",
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

  it("passes an empty dependency object to cooldown when computed dependencies are missing", async () => {
    expect.assertions(1);

    const fixture = createTestFixture();
    const { store } = fixture;
    store.setTaskRunner(fixture.createTaskRunner());

    const resource = defineResource({
      id: "store-cooldown-missing-computed-deps",
      async cooldown(_value, _config, deps) {
        expect(deps).toEqual({});
      },
    });

    store.storeGenericItem(resource);

    const entry = store.resources.get(resource.id)!;
    entry.isInitialized = true;
    entry.computedDependencies = undefined;
    store.recordResourceInitialized(resource.id);

    await store.cooldown();
  });

  it("normalizes non-error ready failures from parallel waves", async () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    store.setTaskRunner(fixture.createTaskRunner());

    const failing = defineResource({
      id: "store-ready-parallel-failure-failing",
      async ready() {
        throw "ready-string-failure";
      },
    });

    const sibling = defineResource({
      id: "store-ready-parallel-failure-sibling",
      async ready() {
        return;
      },
    });

    store.storeGenericItem(failing);
    store.storeGenericItem(sibling);

    store.resources.get(failing.id)!.isInitialized = true;
    store.resources.get(sibling.id)!.isInitialized = true;
    store.recordInitWave([failing.id, sibling.id]);

    await expect(store.ready()).rejects.toMatchObject({
      message: "ready-string-failure",
    });
  });

  it("rethrows Error ready failures from parallel waves without re-wrapping", async () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    store.setTaskRunner(fixture.createTaskRunner());

    const readyFailure = new Error("ready-error-failure");
    const failing = defineResource({
      id: "store-ready-parallel-failure-error",
      async ready() {
        throw readyFailure;
      },
    });

    const sibling = defineResource({
      id: "store-ready-parallel-failure-error-sibling",
      async ready() {
        return;
      },
    });

    store.storeGenericItem(failing);
    store.storeGenericItem(sibling);

    store.resources.get(failing.id)!.isInitialized = true;
    store.resources.get(sibling.id)!.isInitialized = true;
    store.recordInitWave([failing.id, sibling.id]);

    await expect(store.ready()).rejects.toMatchObject({
      message: readyFailure.message,
    });
  });

  it("normalizes non-error ready failures from sequential waves", async () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    store.setTaskRunner(fixture.createTaskRunner());

    const failing = defineResource({
      id: "store-ready-sequential-failure-failing",
      async ready() {
        throw "ready-sequential-string-failure";
      },
    });

    store.storeGenericItem(failing);
    store.resources.get(failing.id)!.isInitialized = true;
    store.recordResourceInitialized(failing.id);

    await expect(store.ready()).rejects.toMatchObject({
      message: "ready-sequential-string-failure",
    });
  });

  it("ignores ready execution requests for unknown resources", async () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    store.setTaskRunner(fixture.createTaskRunner());

    await expect(store.readyResource("store-ready-unknown")).resolves.toBe(
      undefined,
    );
  });

  it("rejects ready execution for known resources after shutdown has started", async () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    store.setTaskRunner(fixture.createTaskRunner());

    const resource = defineResource({
      id: "store-ready-shutdown-resource",
      async ready() {
        return;
      },
    });

    store.storeGenericItem(resource);
    store.resources.get(resource.id)!.isInitialized = true;
    store.recordResourceInitialized(resource.id);
    store.beginCoolingDown();

    await expect(store.readyResource(resource.id)).rejects.toThrow(
      /cannot be lazy-initialized because shutdown has already started/i,
    );
  });
});
