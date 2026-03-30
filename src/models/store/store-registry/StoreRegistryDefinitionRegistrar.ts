import {
  AnyResource,
  IEvent,
  IHook,
  IResource,
  IResourceMiddleware,
  IResourceWithConfig,
  ITag,
  ITask,
  ITaskMiddleware,
  RegisterableItem,
  symbolResourceIsolateDeclarations,
} from "../../../defs";
import type { IAsyncContext } from "../../../types/asyncContext";
import type { IErrorHelper } from "../../../types/error";
import type { RunnerMode } from "../../../types/runner";
import { HookDependencyState } from "../../../types/storeTypes";
import { resolveIsolatePolicyDeclarations } from "../../../definers/isolatePolicy";
import { VisibilityTracker } from "../../VisibilityTracker";
import { StoreRegistryDefinitionPreparer } from "./StoreRegistryDefinitionPreparer";
import { StoreRegistryOwnedRegistrationCompiler } from "./StoreRegistryOwnedRegistrationCompiler";
import { StoreRegistryReferenceNormalizer } from "./StoreRegistryReferenceNormalizer";
import { StoreRegistryTagIndex } from "./StoreRegistryTagIndex";
import { StoreRegistryTagReferenceNormalizer } from "./StoreRegistryTagReferenceNormalizer";
import { IndexedTagCategory, StoringMode } from "./types";
import type {
  StoreRegistryAliasResolver,
  StoreRegistryCollections,
  StoreRegistryValidation,
} from "./StoreRegistryWriter.types";

type StoreGenericItemHandler = (item: RegisterableItem) => void;

export class StoreRegistryDefinitionRegistrar {
  constructor(
    private readonly collections: StoreRegistryCollections,
    private readonly validator: StoreRegistryValidation,
    private readonly visibilityTracker: VisibilityTracker,
    private readonly tagIndex: StoreRegistryTagIndex,
    private readonly definitionPreparer: StoreRegistryDefinitionPreparer,
    private readonly aliasResolver: StoreRegistryAliasResolver,
    private readonly getRuntimeMode: () => RunnerMode,
    private readonly ownedRegistrationCompiler: StoreRegistryOwnedRegistrationCompiler,
    private readonly referenceNormalizer: StoreRegistryReferenceNormalizer,
    private readonly tagReferenceNormalizer: StoreRegistryTagReferenceNormalizer,
    private readonly storeGenericItem: StoreGenericItemHandler,
  ) {}

  storeError<_C>(item: IErrorHelper<any>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.errors.set(item.id, item);
    this.finalizeStoredDefinition(
      item.id,
      [item],
      IndexedTagCategory.Errors,
      item.tags,
    );
  }

  storeAsyncContext<_C>(item: IAsyncContext<any>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.asyncContexts.set(item.id, item);
    this.finalizeStoredDefinition(item.id, [item]);
  }

  storeTag(item: ITag<any, any, any>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.tags.set(item.id, item);
    this.finalizeStoredDefinition(item.id, [item]);
  }

  storeHook<_C>(item: IHook<any, any>, overrideMode: StoringMode) {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);

    const hook = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.hooks,
      key: "hook",
      mode: overrideMode,
      runtimeMode: this.getRuntimeMode(),
      overrideTargetType: "Hook",
    });

    this.collections.hooks.set(hook.id, {
      hook,
      computedDependencies: {},
      dependencyState: HookDependencyState.Pending,
    });
    this.finalizeStoredDefinition(
      hook.id,
      [item, hook],
      IndexedTagCategory.Hooks,
      hook.tags,
    );
  }

  storeTaskMiddleware<_C>(
    item: ITaskMiddleware<any>,
    storingMode: StoringMode,
  ) {
    storingMode === "normal" && this.validator.checkIfIDExists(item.id);

    const middleware = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.taskMiddlewares,
      key: "middleware",
      mode: storingMode,
      runtimeMode: this.getRuntimeMode(),
      overrideTargetType: "Task middleware",
    });

    this.collections.taskMiddlewares.set(middleware.id, {
      middleware,
      computedDependencies: {},
      isInitialized: false,
    });
    this.finalizeStoredDefinition(
      middleware.id,
      [item, middleware],
      IndexedTagCategory.TaskMiddlewares,
      middleware.tags,
    );
  }

  storeResourceMiddleware<_C>(
    item: IResourceMiddleware<any>,
    storingMode: StoringMode,
  ) {
    storingMode === "normal" && this.validator.checkIfIDExists(item.id);

    const middleware = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.resourceMiddlewares,
      key: "middleware",
      mode: storingMode,
      runtimeMode: this.getRuntimeMode(),
      overrideTargetType: "Resource middleware",
    });

    this.collections.resourceMiddlewares.set(middleware.id, {
      middleware,
      computedDependencies: {},
      isInitialized: false,
    });
    this.finalizeStoredDefinition(
      middleware.id,
      [item, middleware],
      IndexedTagCategory.ResourceMiddlewares,
      middleware.tags,
    );
  }

  storeEvent<_C>(item: IEvent<void>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.events.set(item.id, { event: item });
    this.finalizeStoredDefinition(
      item.id,
      [item],
      IndexedTagCategory.Events,
      item.tags,
    );
  }

  storeResourceWithConfig<_C>(
    item: IResourceWithConfig<any, any, any>,
    storingMode: StoringMode,
  ) {
    storingMode === "normal" &&
      this.validator.checkIfIDExists(item.resource.id);

    const prepared = this.definitionPreparer.prepareFreshValue({
      item: item.resource,
      collection: this.collections.resources,
      key: "resource",
      mode: storingMode,
      config: item.config,
      runtimeMode: this.getRuntimeMode(),
      overrideTargetType: "Resource",
    });
    prepared.isolate = resolveIsolatePolicyDeclarations(
      prepared[symbolResourceIsolateDeclarations],
      item.config,
      this.getRuntimeMode(),
      prepared.id,
    );
    prepared.subtree =
      this.referenceNormalizer.normalizeResourceSubtreeMiddlewareAttachments(
        prepared,
        item.config,
        this.getRuntimeMode(),
      );

    this.collections.resources.set(prepared.id, {
      resource: prepared,
      config: item.config,
      value: undefined,
      isInitialized: false,
      context: undefined,
    });
    this.visibilityTracker.recordResource(prepared.id);
    this.visibilityTracker.recordIsolation(prepared.id, prepared.isolate);
    this.finalizeStoredDefinition(
      prepared.id,
      [item, item.resource, prepared],
      IndexedTagCategory.Resources,
      prepared.tags,
    );

    this.storeOwnedRegistrations(prepared, item.config);
    return prepared;
  }

  storeResource<_C>(item: IResource<any, any, any>, overrideMode: StoringMode) {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);

    const existingResourceEntry =
      overrideMode === "override"
        ? this.collections.resources.get(item.id)
        : undefined;
    const configForResource =
      overrideMode === "override" ? existingResourceEntry!.config : {};

    const prepared = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.resources,
      key: "resource",
      mode: overrideMode,
      config: configForResource,
      runtimeMode: this.getRuntimeMode(),
      overrideTargetType: "Resource",
    });
    prepared.isolate = resolveIsolatePolicyDeclarations(
      prepared[symbolResourceIsolateDeclarations],
      configForResource,
      this.getRuntimeMode(),
      prepared.id,
    );
    prepared.middleware =
      this.referenceNormalizer.normalizeResourceMiddlewareAttachments(prepared);
    prepared.subtree =
      this.referenceNormalizer.normalizeResourceSubtreeMiddlewareAttachments(
        prepared,
        configForResource as _C,
        this.getRuntimeMode(),
      );

    this.collections.resources.set(prepared.id, {
      resource: prepared,
      config: configForResource,
      value: undefined,
      isInitialized: false,
      context: undefined,
    });
    this.visibilityTracker.recordResource(prepared.id);
    this.visibilityTracker.recordIsolation(prepared.id, prepared.isolate);
    this.finalizeStoredDefinition(
      prepared.id,
      [item, prepared],
      IndexedTagCategory.Resources,
      prepared.tags,
    );

    this.storeOwnedRegistrations(prepared, configForResource as _C);
    return prepared as AnyResource;
  }

  storeTask<_C>(item: ITask<any, any, {}>, storingMode: StoringMode) {
    storingMode === "normal" && this.validator.checkIfIDExists(item.id);

    const task = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.tasks,
      key: "task",
      mode: storingMode,
      runtimeMode: this.getRuntimeMode(),
      overrideTargetType: "Task",
    });
    task.middleware =
      this.referenceNormalizer.normalizeTaskMiddlewareAttachments(task);

    this.collections.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });
    this.finalizeStoredDefinition(
      task.id,
      [item, task],
      IndexedTagCategory.Tasks,
      task.tags,
    );
  }

  private storeOwnedRegistrations<_C>(
    resource: IResource<_C>,
    config: _C | undefined,
  ): void {
    this.ownedRegistrationCompiler.computeRegistrationDeeply(
      resource,
      config,
      this.getRuntimeMode(),
      this.storeGenericItem,
    );
  }

  private finalizeStoredDefinition(
    canonicalId: string,
    references: ReadonlyArray<unknown>,
    category?: IndexedTagCategory,
    tags?: ReadonlyArray<{ id: string }>,
  ): void {
    for (const reference of references) {
      this.aliasResolver.registerDefinitionAlias(reference, canonicalId);
    }

    this.validator.trackRegisteredId(canonicalId);

    if (!category) {
      return;
    }

    const normalizedTags =
      this.tagReferenceNormalizer.normalizeDefinitionTags(tags);
    this.tagIndex.reindexDefinitionTags(category, canonicalId, normalizedTags);
    this.visibilityTracker.recordDefinitionTags(canonicalId, normalizedTags);
  }
}
