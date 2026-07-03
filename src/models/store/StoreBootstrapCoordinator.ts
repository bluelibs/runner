import {
  IEvent,
  IEventEmissionCallOptions,
  IResource,
  RegisterableItem,
} from "../../defs";
import {
  storeAlreadyInitializedError,
  taskRunnerNotSetError,
  validationError,
} from "../../errors";
import { asyncContexts } from "../../asyncContexts";
import { globalResources } from "../../globals/globalResources";
import type { DebugFriendlyConfig } from "../../globals/resources/debug";
import { Serializer } from "../../serializer";
import { resolveExecutionContextConfig } from "../../tools/resolveExecutionContextConfig";
import type { IdentityAsyncContext } from "../../types/runner";
import type { RuntimeCallSource } from "../../types/runtimeSource";
import type { ResourceStoreElementType } from "../../types/storeTypes";
import { createSyntheticFrameworkRoot } from "../createSyntheticFrameworkRoot";
import { EventManager } from "../EventManager";
import { ExecutionContextStore } from "../ExecutionContextStore";
import { Logger } from "../Logger";
import { MiddlewareManager } from "../MiddlewareManager";
import { OverrideManager } from "../OverrideManager";
import { RunResult } from "../RunResult";
import { TaskRunner } from "../TaskRunner";
import { StoreLookup, resolveRequestedIdFromStore } from "./StoreLookup";
import { StoreRegistry } from "./StoreRegistry";
import { StoreValidator } from "./StoreValidator";

type StoreBootstrapState = {
  readonly eventManager: EventManager;
  readonly executionContextStore: ExecutionContextStore;
  readonly logger: Logger;
  readonly middlewareManager: MiddlewareManager;
  readonly mode: string;
  readonly overrideManager: OverrideManager;
  readonly registry: StoreRegistry;
  readonly resources: Map<string, ResourceStoreElementType>;
  readonly lookup: StoreLookup;
  readonly validator: StoreValidator;
  getTaskRunner: () => TaskRunner | undefined;
  isInitialized: () => boolean;
  markInitialized: () => void;
  recordResourceInitialized: (resourceId: string) => void;
  resolveStoreResource: () => unknown;
  resolveRegisteredDefinition: <TDefinition extends RegisterableItem>(
    definition: TDefinition,
  ) => TDefinition;
};

export class StoreBootstrapCoordinator {
  constructor(private readonly state: StoreBootstrapState) {}

  public initializeStore(
    root: IResource<any, any, any, any, any>,
    config: unknown,
    runtimeResult: RunResult<unknown>,
    options?: {
      debug?: DebugFriendlyConfig;
      executionContext?: RunResult<unknown>["runOptions"]["executionContext"];
      identity?: IdentityAsyncContext | null;
    },
  ): ResourceStoreElementType {
    if (this.state.isInitialized()) {
      storeAlreadyInitializedError.throw();
    }

    const frameworkRoot = createSyntheticFrameworkRoot({
      rootItem: root.with(config as any),
      debug: options?.debug,
      executionContext: options?.executionContext ?? null,
      identity: options?.identity ?? null,
    });

    this.state.registry.computeRegistrationDeeply(frameworkRoot);
    this.ensureRuntimeIdentityContextRegistered(options?.identity ?? null);
    this.bindFrameworkResourceValues(runtimeResult);
    const rootEntry = this.resolveRootEntry(root);
    this.state.registry.clearHookTargetResolutionCache();
    this.state.validator.runSanityChecks();

    const overrideTraversalVisited = new Set<string>();
    for (const resource of this.state.resources.values()) {
      this.state.overrideManager.storeOverridesDeeply(
        resource.resource,
        overrideTraversalVisited,
      );
    }

    this.state.markInitialized();
    return rootEntry;
  }

  public bindFrameworkResourceValues(runtimeResult: RunResult<unknown>): void {
    const taskRunner = this.state.getTaskRunner();
    if (!taskRunner) {
      taskRunnerNotSetError.throw();
    }

    this.configureExecutionContextResource();
    const eventManagerFacade = this.createEventManagerFacade();

    const builtInResourcesMap = new Map<
      IResource<any, any, any, any, any>,
      unknown
    >();
    builtInResourcesMap.set(
      globalResources.store,
      this.state.resolveStoreResource(),
    );
    builtInResourcesMap.set(globalResources.eventManager, eventManagerFacade);
    builtInResourcesMap.set(globalResources.mode, this.state.mode);
    builtInResourcesMap.set(globalResources.logger, this.state.logger);
    builtInResourcesMap.set(globalResources.taskRunner, taskRunner);
    builtInResourcesMap.set(globalResources.serializer, new Serializer());
    builtInResourcesMap.set(
      globalResources.executionContext,
      this.state.executionContextStore,
    );
    builtInResourcesMap.set(
      globalResources.middlewareManager,
      this.state.middlewareManager,
    );
    builtInResourcesMap.set(globalResources.runtime, runtimeResult);

    for (const [resource, value] of builtInResourcesMap.entries()) {
      const entry = this.state.resources.get(resource.id);
      if (!entry) {
        continue;
      }

      entry.value = value;
      entry.isInitialized = true;
      this.state.recordResourceInitialized(entry.resource.id);
    }
  }

  public configureExecutionContextResource(): void {
    const entry = this.state.resources.get(globalResources.executionContext.id);
    if (!entry) {
      this.state.executionContextStore.configure(null);
      return;
    }

    this.state.executionContextStore.configure(
      resolveExecutionContextConfig(entry.config),
    );
  }

  public createEventManagerFacade(): EventManager {
    const resolveRuntimeSource = (
      source: RuntimeCallSource,
    ): RuntimeCallSource => ({
      ...source,
      id: resolveRequestedIdFromStore(this.state, source.id) ?? source.id,
    });
    const manager = this.state.eventManager;

    return {
      enterShutdownLockdown: () => manager.enterShutdownLockdown(),
      lock: () => manager.lock(),
      emit: (<TInput>(
        eventDefinition: IEvent<TInput>,
        data: TInput,
        request: RuntimeCallSource | IEventEmissionCallOptions,
      ) => {
        const options =
          "source" in request
            ? {
                ...request,
                source: resolveRuntimeSource(request.source),
              }
            : { source: resolveRuntimeSource(request) };
        return manager.emit(
          this.state.resolveRegisteredDefinition(eventDefinition),
          data,
          options,
        );
      }) as EventManager["emit"],
      emitLifecycle: (<TInput>(
        eventDefinition: IEvent<TInput>,
        data: TInput,
        request: RuntimeCallSource | IEventEmissionCallOptions,
      ) => {
        const options =
          "source" in request
            ? {
                ...request,
                source: resolveRuntimeSource(request.source),
              }
            : { source: resolveRuntimeSource(request) };
        return manager.emitLifecycle(
          this.state.resolveRegisteredDefinition(eventDefinition),
          data,
          options,
        );
      }) as EventManager["emitLifecycle"],
      emitWithResult: (<TInput>(
        eventDefinition: IEvent<TInput>,
        data: TInput,
        request: RuntimeCallSource | IEventEmissionCallOptions,
      ) => {
        const options =
          "source" in request
            ? {
                ...request,
                source: resolveRuntimeSource(request.source),
              }
            : { source: resolveRuntimeSource(request) };
        return manager.emitWithResult(
          this.state.resolveRegisteredDefinition(eventDefinition),
          data,
          options,
        );
      }) as EventManager["emitWithResult"],
      addListener: (<TInput>(
        event: IEvent<TInput> | Array<IEvent<TInput>>,
        handler: Parameters<EventManager["addListener"]>[1],
        options?: Parameters<EventManager["addListener"]>[2],
      ) =>
        manager.addListener(
          Array.isArray(event)
            ? event.map((entry) =>
                this.state.resolveRegisteredDefinition(entry),
              )
            : this.state.resolveRegisteredDefinition(event),
          handler as any,
          options as any,
        )) as EventManager["addListener"],
      addGlobalListener: manager.addGlobalListener.bind(manager),
      removeListenerById: manager.removeListenerById.bind(manager),
      hasListeners: (<TInput>(eventDefinition: IEvent<TInput>) =>
        manager.hasListeners(
          this.state.resolveRegisteredDefinition(eventDefinition),
        )) as EventManager["hasListeners"],
      intercept: manager.intercept.bind(manager),
      interceptHook: manager.interceptHook.bind(manager),
      executeHookWithInterceptors:
        manager.executeHookWithInterceptors.bind(manager),
      dispose: manager.dispose.bind(manager),
      get isLocked() {
        return manager.isLocked;
      },
    } as EventManager;
  }

  public resolveRootEntry(
    rootDefinition: IResource<any>,
  ): ResourceStoreElementType {
    const rootId =
      this.state.lookup.resolveCandidateId(rootDefinition) ?? rootDefinition.id;
    const rootEntry = this.state.resources.get(rootId);

    if (rootEntry) {
      return rootEntry;
    }

    validationError.throw({
      subject: "Root resource",
      id: rootDefinition.id,
      originalError:
        "Root resource was not registered during framework bootstrap. This indicates an inconsistent runtime setup.",
    });

    return undefined as never;
  }

  public ensureRuntimeIdentityContextRegistered(
    identity: IdentityAsyncContext | null,
  ): void {
    const activeIdentity = identity ?? asyncContexts.identity;
    if (this.state.registry.resolveRegisteredReferenceId(activeIdentity)) {
      return;
    }

    this.state.registry.storeOwnedAsyncContext("runner", activeIdentity);
  }
}
