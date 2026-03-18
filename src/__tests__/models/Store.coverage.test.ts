import {
  defineEvent,
  defineResource,
  defineTaskMiddleware,
} from "../../define";
import { isResource } from "../../definers/tools";
import { runtimeElementNotFoundError, validationError } from "../../errors";
import {
  createSyntheticFrameworkRoot,
  FRAMEWORK_RUNNER_RESOURCE_ID,
  FRAMEWORK_SYSTEM_RESOURCE_ID,
  SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID,
} from "../../models/createSyntheticFrameworkRoot";
import { validateFrameworkNamespaceMetadata } from "../../models/frameworkNamespaceMetaPolicy";
import { runtimeSource } from "../../types/runtimeSource";
import { createTestFixture } from "../test-utils";

describe("Store coverage", () => {
  it("finds canonical ids from registered definitions and literal strings", () => {
    const { store } = createTestFixture();
    const definition = defineResource({
      id: "store-coverage-runtime",
    });

    store.storeGenericItem(definition);
    const canonicalId = Array.from(store.resources.keys())[0]!;

    expect(store.findIdByDefinition(definition)).toBe(canonicalId);
    expect(store.findIdByDefinition(canonicalId)).toBe(canonicalId);
    expect(store.resolveRegisteredDefinition(definition)).toBe(
      store.findDefinitionById(canonicalId),
    );
    expect(runtimeSource.runtime("runtime.literal")).toEqual(
      runtimeSource.runtime("runtime.literal"),
    );
  });

  it("falls back to raw ids for owner lookup and fails fast on unresolved lookups", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const ownerSpy = jest.spyOn(
      registry.visibilityTracker,
      "getOwnerResourceId",
    );

    expect(store.getOwnerResourceId("store-coverage-raw")).toBeUndefined();
    expect(ownerSpy).toHaveBeenCalledWith("store-coverage-raw");
    jest.spyOn(registry, "resolveDefinitionId").mockReturnValueOnce(undefined);
    expect(store.getOwnerResourceId("store-coverage-fallback")).toBeUndefined();
    expect(ownerSpy).toHaveBeenCalledWith("store-coverage-fallback");
    expect(() => store.findIdByDefinition({ invalid: true } as any)).toThrow(
      /Expected non-empty string, got (undefined|null) at \$\./,
    );
    jest
      .spyOn(registry, "resolveDefinitionId")
      .mockReturnValue("missing.alias");
    expect(() => store.findIdByDefinition("store-coverage-source-id")).toThrow(
      'Definition "store-coverage-source-id" not found.',
    );
    expect(() => store.findDefinitionById("store-coverage-missing")).toThrow(
      'Definition "store-coverage-missing" not found.',
    );
  });

  it("resolves canonical ids for owner lookup when aliases exist", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const canonicalId = "store-coverage-owned-root.resources.owned";
    jest.spyOn(registry, "resolveDefinitionId").mockReturnValue(canonicalId);
    const ownerSpy = jest
      .spyOn(registry.visibilityTracker, "getOwnerResourceId")
      .mockReturnValue("store-coverage-owner");

    expect(store.getOwnerResourceId("owned")).toBe("store-coverage-owner");
    expect(ownerSpy).toHaveBeenCalledWith(canonicalId);
  });

  it("keeps framework-root canonical ids unchanged", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const frameworkChild = { id: "framework-child-x" };
    const hasIdSpy = jest.spyOn(store, "hasId").mockReturnValue(true);

    registry.registerDefinitionAlias(
      frameworkChild,
      "runtime-framework-root.framework-child-x",
    );

    expect(store.findIdByDefinition(frameworkChild)).toBe(
      "runtime-framework-root.framework-child-x",
    );

    hasIdSpy.mockRestore();
  });

  it("preserves the original root resource during framework composition", () => {
    const root = defineResource({
      id: "store-coverage-root-resource",
    });

    const frameworkRoot = createSyntheticFrameworkRoot({
      rootItem: root,
      debug: undefined,
    });

    const registerEntries = frameworkRoot.register as unknown as Array<{
      id: string;
      meta?: {
        title?: string;
        description?: string;
      };
      [key: symbol]: unknown;
    }>;
    expect(frameworkRoot.id).toBe(SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID);
    expect(frameworkRoot.meta).toEqual({
      title: "Framework Root",
      description:
        "Transparent synthetic bootstrap root that registers the system namespace, runner namespace, and the user app root into a single runtime graph.",
    });
    expect(registerEntries[0]).toMatchObject({
      id: FRAMEWORK_SYSTEM_RESOURCE_ID,
      meta: {
        title: "System Namespace",
        description: expect.stringContaining("locked internal infrastructure"),
      },
    });
    expect(registerEntries[1]).toMatchObject({
      id: FRAMEWORK_RUNNER_RESOURCE_ID,
      meta: {
        title: "Runner Namespace",
        description: expect.stringContaining("built-in Runner utilities"),
      },
    });
    expect(registerEntries[2]?.id).toBe(root.id);
  });

  it("attaches the shared metadata policy to both framework namespace resources", () => {
    const root = defineResource({
      id: "store-coverage-framework-policy-root",
    });

    const frameworkRoot = createSyntheticFrameworkRoot({
      rootItem: root,
      debug: undefined,
    });

    const namespaceResources = (frameworkRoot.register as unknown[]).filter(
      isResource,
    );
    const systemResource = namespaceResources.find(
      (resource) => resource.id === FRAMEWORK_SYSTEM_RESOURCE_ID,
    );
    const runnerResource = namespaceResources.find(
      (resource) => resource.id === FRAMEWORK_RUNNER_RESOURCE_ID,
    );

    expect(systemResource?.subtree).toMatchObject({
      validate: [validateFrameworkNamespaceMetadata],
    });
    expect(runnerResource?.subtree).toMatchObject({
      validate: [validateFrameworkNamespaceMetadata],
    });
  });

  it("rejects framework subtree definitions that omit meta.title or meta.description", () => {
    const missingMetaMiddleware = defineTaskMiddleware({
      id: "store-coverage-missing-meta",
      run: async ({ next }) => next(),
    });

    expect(validateFrameworkNamespaceMetadata(missingMetaMiddleware)).toEqual([
      {
        code: "framework-meta-title-required",
        message:
          'Task middleware "store-coverage-missing-meta" must define meta.title.',
      },
      {
        code: "framework-meta-description-required",
        message:
          'Task middleware "store-coverage-missing-meta" must define meta.description.',
      },
    ]);
  });

  it("fails fast when the computed root resource entry is missing after bootstrap", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const registry = (store as unknown as { registry: any }).registry;
    const taskRunner = fixture.createTaskRunner();
    const root = defineResource({
      id: "store-coverage-missing-root",
    });

    store.setTaskRunner(taskRunner);

    jest.spyOn(registry, "resolveDefinitionId").mockReturnValueOnce(undefined);
    jest.spyOn(store.resources, "get").mockImplementation((resourceId) => {
      if (resourceId === root.id) {
        return undefined;
      }

      return Map.prototype.get.call(store.resources, resourceId);
    });

    expect(() =>
      store.initializeStore(root, {}, fixture.createRuntimeResult(taskRunner)),
    ).toThrow(/Root resource was not registered during framework bootstrap/);
  });

  it("resolves aliased roots and preserves the defensive fallback after validation errors", () => {
    const { store } = createTestFixture();
    const registry = (store as unknown as { registry: any }).registry;
    const resolveRootEntry = (
      store as unknown as {
        resolveRootEntry: (rootDefinition: unknown) => unknown;
      }
    ).resolveRootEntry.bind(store);
    const root = defineResource({
      id: "store-coverage-aliased-root",
    });
    const aliasedEntry = { id: "runner.root.alias" };

    jest
      .spyOn(registry, "resolveDefinitionId")
      .mockReturnValue("runner.root.alias");
    jest.spyOn(store.resources, "get").mockImplementation((resourceId) => {
      if (resourceId === "runner.root.alias") {
        return aliasedEntry;
      }

      return Map.prototype.get.call(store.resources, resourceId);
    });

    expect(resolveRootEntry(root)).toBe(aliasedEntry);

    jest.spyOn(registry, "resolveDefinitionId").mockReturnValue(undefined);
    jest.spyOn(store.resources, "get").mockImplementation((resourceId) => {
      if (resourceId === root.id) {
        return undefined;
      }

      return Map.prototype.get.call(store.resources, resourceId);
    });

    const validationThrowSpy = jest
      .spyOn(Object.getPrototypeOf(validationError), "throw")
      .mockImplementation(() => undefined as never);

    expect(resolveRootEntry(root)).toBeUndefined();
    expect(validationThrowSpy).toHaveBeenCalledWith({
      subject: "Root resource",
      id: root.id,
      originalError:
        "Root resource was not registered during framework bootstrap. This indicates an inconsistent runtime setup.",
    });
  });

  it("forwards facade event operations through registered canonical events", async () => {
    const fixture = createTestFixture();
    const { store, eventManager } = fixture;
    const event = defineEvent<{ value: number }>({
      id: "store-coverage-facade-event",
    });
    const source = runtimeSource.runtime("store-coverage-facade");
    const handler = jest.fn();
    const lifecycleReport = { report: "ok" };
    const resultPayload = { value: 2 };

    store.storeGenericItem(event);

    const facade = (
      store as unknown as {
        createEventManagerFacade: () => {
          enterShutdownLockdown(): void;
          lock(): void;
          emitLifecycle(
            eventDefinition: unknown,
            data: { value: number },
            sourceDefinition: unknown,
          ): Promise<unknown>;
          emitWithResult(
            eventDefinition: unknown,
            data: { value: number },
            sourceDefinition: unknown,
          ): Promise<{ value: number }>;
          addListener(eventDefinitions: unknown[], eventHandler: unknown): void;
          hasListeners(eventDefinition: unknown): boolean;
          readonly isLocked: boolean;
        };
      }
    ).createEventManagerFacade();

    const shutdownSpy = jest.spyOn(eventManager, "enterShutdownLockdown");
    const lockSpy = jest.spyOn(eventManager, "lock");
    const emitLifecycleSpy = jest
      .spyOn(eventManager, "emitLifecycle")
      .mockResolvedValue(lifecycleReport as never);
    const emitWithResultSpy = jest
      .spyOn(eventManager, "emitWithResult")
      .mockResolvedValue(resultPayload);
    const addListenerSpy = jest.spyOn(eventManager, "addListener");
    const hasListenersSpy = jest
      .spyOn(eventManager, "hasListeners")
      .mockReturnValue(true);

    facade.addListener([event], handler);
    facade.enterShutdownLockdown();
    facade.lock();
    await expect(
      facade.emitLifecycle(event, { value: 1 }, source),
    ).resolves.toBe(lifecycleReport);
    await expect(
      facade.emitWithResult(event, resultPayload, source),
    ).resolves.toEqual(resultPayload);
    expect(facade.hasListeners(event)).toBe(true);
    expect(facade.isLocked).toBe(true);

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    expect(lockSpy).toHaveBeenCalledTimes(1);
    expect(emitLifecycleSpy).toHaveBeenCalledWith(
      event,
      { value: 1 },
      {
        source,
      },
    );
    expect(emitWithResultSpy).toHaveBeenCalledWith(event, resultPayload, {
      source,
    });
    expect(addListenerSpy).toHaveBeenCalledWith([event], handler, undefined);
    expect(hasListenersSpy).toHaveBeenCalledWith(event);
  });

  it("fails fast when a facade event resolves canonically but is missing from the event registry", () => {
    const { store } = createTestFixture();
    const event = defineEvent({
      id: "store-coverage-facade-missing-event",
    });

    store.storeGenericItem(event);
    const canonicalId = store.findIdByDefinition(event);
    const facade = (
      store as unknown as {
        createEventManagerFacade: () => {
          hasListeners(eventDefinition: unknown): boolean;
        };
      }
    ).createEventManagerFacade();

    jest.spyOn(store.events, "get").mockImplementation((eventId) => {
      if (eventId === canonicalId) {
        return undefined;
      }

      return Map.prototype.get.call(store.events, eventId);
    });

    const runtimeElementNotFoundSpy = jest
      .spyOn(Object.getPrototypeOf(runtimeElementNotFoundError), "throw")
      .mockImplementation(() => undefined as never);

    expect(() => facade.hasListeners(event)).toThrow(
      /Cannot read properties of undefined \(reading 'id'\)/,
    );
    expect(runtimeElementNotFoundSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "Definition",
        elementId: canonicalId,
      }),
    );
  });
});
