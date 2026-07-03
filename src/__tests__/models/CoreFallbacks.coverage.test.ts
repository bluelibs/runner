import { defineEvent, defineResource } from "../../define";
import { toCanonicalDefinitionFromStore } from "../../models/store/StoreLookup";
import { runtimeSource } from "../../types/runtimeSource";
import { createTestFixture } from "../test-utils";

describe("core fallback coverage", () => {
  it("Store preserves runtime source ids and handles owner, root, and canonical definition misses", async () => {
    const fixture = createTestFixture();
    const { store, eventManager } = fixture;
    const registry = (store as unknown as { registry: any }).registry;
    const ownerSpy = jest.spyOn(
      registry.visibilityTracker,
      "getOwnerResourceId",
    );
    const unresolvedReference = { missing: true };

    expect(
      store.getOwnerResourceId(unresolvedReference as any),
    ).toBeUndefined();
    expect(ownerSpy).toHaveBeenCalledWith(unresolvedReference);

    const event = defineEvent<{ value: number }>({
      id: "store-core-fallback-event",
    });
    store.storeGenericItem(event);

    const emitSpy = jest
      .spyOn(eventManager, "emit")
      .mockResolvedValue(undefined as never);
    const facade = (
      store as unknown as {
        createEventManagerFacade: () => {
          emit(
            eventDefinition: unknown,
            data: { value: number },
            options: {
              source: ReturnType<typeof runtimeSource.runtime>;
            },
          ): Promise<void>;
        };
      }
    ).createEventManagerFacade();

    await facade.emit(
      event,
      { value: 1 },
      {
        source: runtimeSource.runtime("store-core-fallback-source"),
      },
    );

    expect(emitSpy).toHaveBeenCalledWith(
      expect.anything(),
      { value: 1 },
      {
        source: runtimeSource.runtime("store-core-fallback-source"),
      },
    );

    const root = defineResource({
      id: "store-core-fallback-root",
    });
    const rootEntry = { resource: root };
    jest.spyOn(registry, "resolveDefinitionId").mockReturnValue(undefined);
    store.resources.set(root.id, rootEntry as never);

    expect(
      (
        store as unknown as {
          resolveRootEntry: (rootDefinition: unknown) => unknown;
        }
      ).resolveRootEntry(root),
    ).toBe(rootEntry);

    const unresolvedDefinition = { id: "", path: "keep-original-path" };
    expect(toCanonicalDefinitionFromStore(store, unresolvedDefinition)).toBe(
      unresolvedDefinition,
    );
  });

  it("RunResult delegates runtime-element lookup to the store", () => {
    const fixture = createTestFixture();
    const taskRunner = fixture.createTaskRunner();
    fixture.store.setTaskRunner(taskRunner);
    const runtime = fixture.createRuntimeResult(taskRunner);

    jest.spyOn(fixture.store, "findIdByDefinition").mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() =>
      runtime.getResourceValue("store-core-runtime-missing"),
    ).toThrow("boom");
  });
});
