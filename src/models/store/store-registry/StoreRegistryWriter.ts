import {
  IEvent,
  IHook,
  IResource,
  IResourceMiddleware,
  IResourceWithConfig,
  ITag,
  TagType,
  ITask,
  ITaskMiddleware,
  RegisterableItem,
  SubtreeResourceMiddlewareEntry,
  SubtreeTaskMiddlewareEntry,
} from "../../../defs";
import { unknownItemTypeError } from "../../../errors";
import type { IAsyncContext } from "../../../types/asyncContext";
import type { IErrorHelper } from "../../../types/error";
import type { RunnerMode } from "../../../types/runner";
import { VisibilityTracker } from "../../VisibilityTracker";
import { CanonicalIdCompiler } from "./CanonicalIdCompiler";
import { StoreRegistryDefinitionCloner } from "./StoreRegistryDefinitionCloner";
import { StoreRegistryDefinitionPreparer } from "./StoreRegistryDefinitionPreparer";
import { StoreRegistryDefinitionRegistrar } from "./StoreRegistryDefinitionRegistrar";
import type { OwnerScope } from "./OwnerScope";
import { StoreRegistryOwnedRegistrationCompiler } from "./StoreRegistryOwnedRegistrationCompiler";
import { StoreRegistryReferenceNormalizer } from "./StoreRegistryReferenceNormalizer";
import { RegisterableKind, resolveRegisterableKind } from "./registerableKind";
import { StoreRegistryTagIndex } from "./StoreRegistryTagIndex";
import { StoreRegistryTagReferenceNormalizer } from "./StoreRegistryTagReferenceNormalizer";
import { StoringMode } from "./types";
import type {
  StoreRegistryAliasResolver,
  StoreRegistryCollections,
  StoreRegistryValidation,
} from "./StoreRegistryWriter.types";

export class StoreRegistryWriter {
  private readonly definitionRegistrar: StoreRegistryDefinitionRegistrar;
  private readonly ownedRegistrationCompiler: StoreRegistryOwnedRegistrationCompiler;
  private readonly referenceNormalizer: StoreRegistryReferenceNormalizer;
  private readonly tagReferenceNormalizer: StoreRegistryTagReferenceNormalizer;

  constructor(
    private readonly collections: StoreRegistryCollections,
    private readonly validator: StoreRegistryValidation,
    private readonly visibilityTracker: VisibilityTracker,
    private readonly tagIndex: StoreRegistryTagIndex,
    private readonly definitionPreparer: StoreRegistryDefinitionPreparer,
    private readonly aliasResolver: StoreRegistryAliasResolver,
    private readonly getRuntimeMode: () => RunnerMode,
  ) {
    const canonicalIdCompiler = new CanonicalIdCompiler();
    const definitionCloner = new StoreRegistryDefinitionCloner();

    this.ownedRegistrationCompiler = new StoreRegistryOwnedRegistrationCompiler(
      canonicalIdCompiler,
      this.aliasResolver,
      this.visibilityTracker,
      definitionCloner,
    );
    this.referenceNormalizer = new StoreRegistryReferenceNormalizer(
      canonicalIdCompiler,
      this.collections,
      this.aliasResolver,
      definitionCloner,
    );
    this.tagReferenceNormalizer = new StoreRegistryTagReferenceNormalizer(
      this.aliasResolver,
      definitionCloner,
    );
    this.definitionRegistrar = new StoreRegistryDefinitionRegistrar(
      this.collections,
      this.validator,
      this.visibilityTracker,
      this.tagIndex,
      this.definitionPreparer,
      this.aliasResolver,
      this.getRuntimeMode,
      this.ownedRegistrationCompiler,
      this.referenceNormalizer,
      this.tagReferenceNormalizer,
      (item) => this.storeGenericItem(item),
    );
  }

  storeGenericItem<_C>(item: RegisterableItem) {
    const kind = resolveRegisterableKind(item);

    switch (kind) {
      case RegisterableKind.Task:
        this.storeTask<_C>(item as ITask<any, any, {}>);
        return;
      case RegisterableKind.Error:
        this.storeError<_C>(item as IErrorHelper<any>);
        return;
      case RegisterableKind.Hook:
        this.storeHook<_C>(item as IHook);
        return;
      case RegisterableKind.Resource:
        this.storeResource<_C>(item as IResource<any, any, any>);
        return;
      case RegisterableKind.Event:
        this.storeEvent<_C>(item as IEvent<void>);
        return;
      case RegisterableKind.AsyncContext:
        this.storeAsyncContext<_C>(item as IAsyncContext<any>);
        return;
      case RegisterableKind.TaskMiddleware:
        this.storeTaskMiddleware<_C>(item as ITaskMiddleware<any>);
        return;
      case RegisterableKind.ResourceMiddleware:
        this.storeResourceMiddleware<_C>(item as IResourceMiddleware<any>);
        return;
      case RegisterableKind.ResourceWithConfig:
        this.storeResourceWithConfig<_C>(
          item as IResourceWithConfig<any, any, any>,
        );
        return;
      case RegisterableKind.Tag:
        this.storeTag(item as ITag<any, any, any>);
        return;
      default:
        unknownItemTypeError.throw({ item });
    }
  }

  storeError<_C>(item: IErrorHelper<any>) {
    return this.definitionRegistrar.storeError<_C>(item);
  }

  storeAsyncContext<_C>(item: IAsyncContext<any>) {
    return this.definitionRegistrar.storeAsyncContext<_C>(item);
  }

  storeTag(item: ITag<any, any, any>) {
    return this.definitionRegistrar.storeTag(item);
  }

  storeHook<_C>(item: IHook<any, any>, overrideMode: StoringMode = "normal") {
    return this.definitionRegistrar.storeHook<_C>(item, overrideMode);
  }

  storeTaskMiddleware<_C>(
    item: ITaskMiddleware<any>,
    storingMode: StoringMode = "normal",
  ) {
    return this.definitionRegistrar.storeTaskMiddleware<_C>(item, storingMode);
  }

  storeResourceMiddleware<_C>(
    item: IResourceMiddleware<any>,
    storingMode: StoringMode = "normal",
  ) {
    return this.definitionRegistrar.storeResourceMiddleware<_C>(
      item,
      storingMode,
    );
  }

  storeEvent<_C>(item: IEvent<void>) {
    return this.definitionRegistrar.storeEvent<_C>(item);
  }

  storeResourceWithConfig<_C>(
    item: IResourceWithConfig<any, any, any>,
    storingMode: StoringMode = "normal",
  ) {
    return this.definitionRegistrar.storeResourceWithConfig<_C>(
      item,
      storingMode,
    );
  }

  computeRegistrationDeeply<_C>(
    element: IResource<_C>,
    config: _C | undefined,
    runtimeMode: RunnerMode,
  ) {
    return this.ownedRegistrationCompiler.computeRegistrationDeeply(
      element,
      config,
      runtimeMode,
      (item) => this.storeGenericItem<_C>(item),
    );
  }

  public computeCanonicalId(
    ownerResourceId: string,
    ownerUsesFrameworkRootIds: boolean,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
    currentId: string,
  ): string {
    return this.ownedRegistrationCompiler.computeCanonicalId(
      ownerResourceId,
      ownerUsesFrameworkRootIds,
      kind,
      currentId,
    );
  }

  public compileOwnedDefinition(
    ownerResourceId: string,
    ownerUsesFrameworkRootIds: boolean,
    item: RegisterableItem,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
  ): RegisterableItem {
    return this.ownedRegistrationCompiler.compileOwnedDefinition(
      ownerResourceId,
      ownerUsesFrameworkRootIds,
      item,
      kind,
    );
  }

  public resolveRegisterableId(item: RegisterableItem): string | undefined {
    return this.ownedRegistrationCompiler.resolveRegisterableId(item);
  }

  storeResource<_C>(
    item: IResource<any, any, any>,
    overrideMode: StoringMode = "normal",
  ) {
    return this.definitionRegistrar.storeResource<_C>(item, overrideMode);
  }

  storeTask<_C>(
    item: ITask<any, any, {}>,
    storingMode: StoringMode = "normal",
  ) {
    return this.definitionRegistrar.storeTask<_C>(item, storingMode);
  }

  public normalizeTaskMiddlewareAttachments(
    task: ITask<any, any, {}>,
  ): ITask<any, any, {}>["middleware"] {
    return this.referenceNormalizer.normalizeTaskMiddlewareAttachments(task);
  }

  public normalizeResourceSubtreeMiddlewareAttachments(
    resource: IResource<any, any, any>,
    config: unknown,
    runtimeMode: RunnerMode,
  ): IResource<any, any, any>["subtree"] {
    return this.referenceNormalizer.normalizeResourceSubtreeMiddlewareAttachments(
      resource,
      config,
      runtimeMode,
    );
  }

  public normalizeSubtreeTaskMiddlewareEntry(
    ownerScopeOrResourceId: OwnerScope | string,
    entryOrUsesFrameworkRootIds: SubtreeTaskMiddlewareEntry | boolean,
    maybeEntry?: SubtreeTaskMiddlewareEntry,
  ) {
    return this.referenceNormalizer.normalizeSubtreeTaskMiddlewareEntry(
      ownerScopeOrResourceId,
      entryOrUsesFrameworkRootIds,
      maybeEntry,
    );
  }

  public normalizeSubtreeResourceMiddlewareEntry(
    ownerScopeOrResourceId: OwnerScope | string,
    entryOrUsesFrameworkRootIds: SubtreeResourceMiddlewareEntry | boolean,
    maybeEntry?: SubtreeResourceMiddlewareEntry,
  ) {
    return this.referenceNormalizer.normalizeSubtreeResourceMiddlewareEntry(
      ownerScopeOrResourceId,
      entryOrUsesFrameworkRootIds,
      maybeEntry,
    );
  }

  public resolveOwnerResourceIdFromTaskId(taskId: string): string | null {
    return this.referenceNormalizer.resolveOwnerResourceIdFromTaskId(taskId);
  }

  public didArrayChange<T>(
    source: ReadonlyArray<T>,
    next: ReadonlyArray<T>,
  ): boolean {
    return this.referenceNormalizer.didArrayChange(source, next);
  }

  public normalizeDefinitionTags(
    tags: ReadonlyArray<{ id: string }> | undefined,
  ): TagType[] {
    return this.tagReferenceNormalizer.normalizeDefinitionTags(tags);
  }
}
