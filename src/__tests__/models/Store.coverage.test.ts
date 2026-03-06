import { defineEvent } from "../../define";
import { createTestFixture } from "../test-utils";

describe("Store coverage", () => {
  it("keeps original events when definition resolution misses or no stored event exists", () => {
    const { store, eventManager } = createTestFixture();
    const resolver = (
      eventManager as unknown as {
        eventDefinitionResolver: (eventDefinition: unknown) => unknown;
      }
    ).eventDefinitionResolver;
    const event = defineEvent({
      id: "store.coverage.event",
    });
    const resolveSpy = jest.spyOn(store, "resolveDefinitionId");

    resolveSpy.mockReturnValueOnce(undefined);
    expect(resolver(event)).toBe(event);

    resolveSpy.mockReturnValueOnce("store.coverage.event.missing");
    expect(resolver(event)).toBe(event);
  });

  it("falls back to raw ids for owner lookup and fails fast on unresolved public ids", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const ownerSpy = jest.spyOn(
      registry.visibilityTracker,
      "getOwnerResourceId",
    );

    jest.spyOn(store, "resolveDefinitionId").mockReturnValue(undefined);

    expect(store.getOwnerResourceId("store.coverage.raw")).toBeUndefined();
    expect(ownerSpy).toHaveBeenCalledWith("store.coverage.raw");
    expect(() => store.toPublicId({ invalid: true } as any)).toThrow(
      /Unable to resolve a definition id/,
    );
  });
});
