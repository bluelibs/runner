import { defineEvent, defineResource } from "../../define";
import { toCanonicalDefinitionFromStore } from "../../models/StoreLookup";
import { runtimeSource } from "../../types/runtimeSource";
import { createTestFixture } from "../test-utils";

describe("Store lookup fallback coverage", () => {
  it("uses requested-id then raw-id fallbacks for owner lookup", () => {
    const { store } = createTestFixture();
    const lookup = (
      store as unknown as {
        lookup: {
          resolveCandidateId: (reference: unknown) => string | null;
          extractRequestedId: (reference: unknown) => string | null;
        };
      }
    ).lookup;
    const ownerSpy = jest.spyOn(
      (store as unknown as { registry: any }).registry.visibilityTracker,
      "getOwnerResourceId",
    );

    jest
      .spyOn(lookup, "resolveCandidateId")
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);
    jest
      .spyOn(lookup, "extractRequestedId")
      .mockReturnValueOnce("store-owner-extracted-id")
      .mockReturnValueOnce(null);

    store.getOwnerResourceId("store-owner-input-a");
    store.getOwnerResourceId("store-owner-input-b");

    expect(ownerSpy).toHaveBeenNthCalledWith(1, "store-owner-extracted-id");
    expect(ownerSpy).toHaveBeenNthCalledWith(2, "store-owner-input-b");
  });

  it("falls back to source.id when runtime source canonicalization is unavailable", async () => {
    const fixture = createTestFixture();
    const { store, eventManager } = fixture;
    const event = defineEvent<{ value: number }>({
      id: "store-fallback-facade-event",
    });

    store.storeGenericItem(event);

    const facade = (
      store as unknown as {
        createEventManagerFacade: () => {
          emit(
            eventDefinition: unknown,
            data: unknown,
            sourceDefinition: unknown,
          ): Promise<unknown>;
        };
      }
    ).createEventManagerFacade();

    const emitSpy = jest
      .spyOn(eventManager, "emit")
      .mockResolvedValue(undefined);

    await facade.emit(
      event,
      { value: 1 },
      {
        ...runtimeSource.runtime("store-fallback-runtime-source"),
        id: "",
      },
    );

    expect(emitSpy).toHaveBeenCalledWith(
      event,
      { value: 1 },
      {
        source: expect.objectContaining({ id: "" }),
      },
    );
  });

  it("falls back to root.id and requested ids when canonical lookup misses", () => {
    const { store } = createTestFixture();
    const lookup = (
      store as unknown as {
        lookup: {
          resolveCandidateId: (reference: unknown) => string | null;
        };
        resolveRootEntry: (definition: unknown) => unknown;
      }
    ).lookup;
    const root = defineResource({
      id: "store-fallback-root",
    });
    const rootEntry = {
      resource: root,
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    };

    store.resources.set(root.id, rootEntry as never);
    jest.spyOn(lookup, "resolveCandidateId").mockReturnValue(null);

    expect(
      (
        store as unknown as {
          resolveRootEntry: (definition: unknown) => unknown;
        }
      ).resolveRootEntry(root),
    ).toBe(rootEntry);

    const definition = { id: "store-fallback-no-canonical" };
    expect(toCanonicalDefinitionFromStore(store, definition)).toEqual({
      ...definition,
      path: "store-fallback-no-canonical",
    });
  });
});
