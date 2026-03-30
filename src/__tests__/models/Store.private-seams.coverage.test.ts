import { defineResource, defineTag } from "../../define";
import { runtimeSource } from "../../types/runtimeSource";
import { createTestFixture } from "../test-utils";

describe("Store private seam coverage", () => {
  it("keeps facade delegates and protected seams reachable after the split", async () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const privateStore = store as any;
    const registry = privateStore.registry;
    const visibilityTracker = registry.visibilityTracker;
    const lifecycle = privateStore.lifecycleCoordinator;
    const bootstrap = privateStore.bootstrapCoordinator;
    const taskRunner = fixture.createTaskRunner();
    const runtimeResult = fixture.createRuntimeResult(taskRunner);
    const root = defineResource({ id: "store-private-seam-root" });
    const resource = {
      isInitialized: true,
      resource: {
        id: "store-private-seam-resource",
        ready: jest.fn(async () => undefined),
        dispose: jest.fn(async () => undefined),
        cooldown: jest.fn(async () => []),
      },
      value: undefined,
      config: undefined,
      computedDependencies: undefined,
      context: undefined,
    };
    const wave = {
      parallel: false,
      resources: [resource],
    };
    const tag = defineTag({ id: "store-private-seam-tag" });
    const accessor = { resources: [], tasks: [] };
    const rootEntry = { resource: root };
    const violation = { kind: "visibility" };
    const rootAccess = { accessible: true, exportedIds: ["x"] };

    expect(store.overrides).toBe(privateStore.overrideManager.overrides);
    expect(store.overrideRequests).toBe(
      privateStore.overrideManager.overrideRequests,
    );
    expect(store.isLocked).toBe(false);
    expect(store.getMiddlewareManager()).toBe(privateStore.middlewareManager);
    expect(store.getLifecycleAdmissionController()).toBe(
      privateStore.lifecycleAdmissionController,
    );
    expect(store.getExecutionContextStore()).toBe(
      privateStore.executionContextStore,
    );
    expect(store.getHealthReporter()).toBe(privateStore.healthReporter);

    jest
      .spyOn(visibilityTracker, "isAccessible")
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    jest
      .spyOn(visibilityTracker, "getAccessViolation")
      .mockReturnValue(violation as any);
    jest
      .spyOn(visibilityTracker, "isWithinResourceSubtree")
      .mockReturnValue(true);
    jest
      .spyOn(visibilityTracker, "getRootAccessInfo")
      .mockReturnValue(rootAccess);
    jest
      .spyOn(visibilityTracker, "hasExportsDeclaration")
      .mockReturnValue(true);

    expect(store.isItemVisibleToConsumer("a", "b")).toBe(true);
    expect(store.getAccessViolation("a", "b")).toBe(violation);
    expect(store.isItemWithinResourceSubtree("a", "b")).toBe(true);
    expect(store.getRootAccessInfo("a", "b")).toBe(rootAccess);
    expect(store.hasExportsDeclaration("a")).toBe(true);

    jest.spyOn(lifecycle, "isInShutdownLockdown").mockReturnValue(true);
    jest.spyOn(lifecycle, "isDisposalStarted").mockReturnValue(true);
    jest.spyOn(lifecycle, "canAdmitTaskCall").mockReturnValue(false);
    jest.spyOn(lifecycle, "beginDisposing").mockImplementation(() => undefined);
    jest
      .spyOn(lifecycle, "beginCoolingDown")
      .mockImplementation(() => undefined);
    jest.spyOn(lifecycle, "beginAborting").mockImplementation(() => undefined);
    jest.spyOn(lifecycle, "beginDrained").mockImplementation(() => undefined);
    jest.spyOn(lifecycle, "waitForDrain").mockResolvedValue(true);
    jest
      .spyOn(lifecycle, "trackTaskAbortController")
      .mockReturnValue(() => undefined);
    jest
      .spyOn(lifecycle, "abortInFlightTaskSignals")
      .mockImplementation(() => undefined);
    jest
      .spyOn(lifecycle, "cancelDrainWaiters")
      .mockImplementation(() => undefined);
    jest.spyOn(lifecycle, "markDisposed").mockImplementation(() => undefined);
    jest
      .spyOn(lifecycle, "enterShutdownLockdown")
      .mockImplementation(() => undefined);
    jest.spyOn(lifecycle, "ready").mockResolvedValue(undefined);
    jest.spyOn(lifecycle, "readyResource").mockResolvedValue(undefined);
    jest.spyOn(lifecycle, "cooldown").mockResolvedValue(undefined);
    jest.spyOn(lifecycle, "cooldownWave").mockResolvedValue([]);
    jest.spyOn(lifecycle, "readyWave").mockResolvedValue(undefined);
    jest
      .spyOn(lifecycle, "assertLazyResourceWakeupAllowed")
      .mockImplementation(() => undefined);
    jest.spyOn(lifecycle, "dispose").mockResolvedValue(undefined);
    jest
      .spyOn(lifecycle, "recordResourceInitialized")
      .mockImplementation(() => undefined);
    jest.spyOn(lifecycle, "recordInitWave").mockImplementation(() => undefined);

    expect(store.isInShutdownLockdown()).toBe(true);
    expect(store.isDisposalStarted()).toBe(true);
    expect(store.canAdmitTaskCall(runtimeSource.runtime("x"))).toBe(false);
    store.beginDisposing();
    store.beginCoolingDown();
    store.beginAborting();
    store.beginDrained();
    await expect(store.waitForDrain(1)).resolves.toBe(true);
    expect(
      store.trackTaskAbortController(new AbortController())(),
    ).toBeUndefined();
    store.abortInFlightTaskSignals("reason");
    store.cancelDrainWaiters();
    store.markDisposed();
    store.enterShutdownLockdown();
    await expect(store.ready()).resolves.toBeUndefined();
    await expect(store.readyResource("x")).resolves.toBeUndefined();
    await expect(store.cooldown()).resolves.toBeUndefined();
    await expect(store.dispose()).resolves.toBeUndefined();
    store.recordResourceInitialized("x");
    store.recordInitWave(["x"]);
    store.assertLazyResourceWakeupAllowed("x");

    store.setTaskRunner(taskRunner);

    jest
      .spyOn(bootstrap, "createEventManagerFacade")
      .mockReturnValue({ emit: jest.fn() } as any);
    jest.spyOn(bootstrap, "resolveRootEntry").mockReturnValue(rootEntry as any);

    expect(privateStore.createEventManagerFacade().emit).toBeDefined();
    expect(privateStore.resolveRootEntry(root)).toBe(rootEntry);
    await expect(privateStore.cooldownWave(wave)).resolves.toEqual([]);
    await expect(privateStore.readyWave(wave)).resolves.toBeUndefined();

    jest
      .spyOn(privateStore.overrideManager, "processOverrides")
      .mockImplementation(() => undefined);
    jest
      .spyOn(registry, "clearHookTargetResolutionCache")
      .mockImplementation(() => undefined);
    jest
      .spyOn(privateStore.validator, "runSanityChecks")
      .mockImplementation(() => undefined);
    store.processOverrides();

    jest.spyOn(registry, "storeGenericItem").mockReturnValue(root as any);
    expect(store.storeGenericItem(root)).toBe(root);

    jest.spyOn(registry, "getTagAccessor").mockReturnValue(accessor as any);
    expect(store.getTagAccessor(tag)).toBe(accessor);

    expect(runtimeResult).toBeDefined();
  });

  it("covers lifecycle coordinator helper branches directly", async () => {
    const fixture = createTestFixture();
    const { store, logger } = fixture;
    const privateStore = store as any;
    const lifecycle = privateStore.lifecycleCoordinator as any;
    const registry = privateStore.registry as any;
    const controller = store.getLifecycleAdmissionController();
    const target = defineResource({ id: "store-lifecycle-target" });
    const readyResource = {
      isInitialized: true,
      resource: {
        id: "store-lifecycle-ready-resource",
        ready: jest.fn(async () => undefined),
        dispose: jest.fn(async () => undefined),
        cooldown: jest.fn(async () => [target]),
      },
      value: "value",
      config: { enabled: true },
      computedDependencies: undefined,
      context: { scope: "ctx" },
    };

    expect(lifecycle.normalizeError("boom")).toBeInstanceOf(Error);
    const originalError = new Error("original");
    expect(lifecycle.normalizeError(originalError)).toBe(originalError);

    jest.spyOn(logger, "warn").mockRejectedValueOnce(new Error("log-failure"));
    await expect(
      lifecycle.logCooldownErrors([new Error("cooldown")]),
    ).resolves.toBeUndefined();

    await expect(
      lifecycle.runReadyResource(readyResource),
    ).resolves.toBeUndefined();
    expect(readyResource.resource.ready).toHaveBeenCalledTimes(1);
    await expect(
      lifecycle.runReadyResource(readyResource),
    ).resolves.toBeUndefined();
    expect(readyResource.resource.ready).toHaveBeenCalledTimes(1);

    await expect(
      lifecycle.disposeResource(readyResource),
    ).resolves.toBeUndefined();
    expect(readyResource.resource.dispose).toHaveBeenCalledTimes(1);

    store.resources.set(readyResource.resource.id, readyResource as any);
    store.resources.set("store-lifecycle-target", {
      resource: target,
      isInitialized: true,
    } as any);
    jest
      .spyOn(registry, "resolveDefinitionId")
      .mockImplementation((reference) =>
        reference === target
          ? "store-lifecycle-target"
          : typeof reference === "string"
            ? reference
            : (reference as { id?: string })?.id,
      );
    const allowSpy = jest.spyOn(controller, "allowShutdownResourceSource");
    await expect(
      lifecycle.cooldownResource(readyResource),
    ).resolves.toBeUndefined();
    expect(readyResource.resource.cooldown).toHaveBeenCalledTimes(1);
    expect(allowSpy).toHaveBeenNthCalledWith(1, readyResource.resource.id);
    expect(allowSpy).toHaveBeenNthCalledWith(2, "store-lifecycle-target");

    jest.spyOn(registry, "resolveDefinitionId").mockReturnValueOnce(undefined);
    expect(() =>
      lifecycle.resolveCooldownAdmissionTargetPath(
        readyResource.resource,
        target,
      ),
    ).toThrow(/cooldown/i);
  });
});
