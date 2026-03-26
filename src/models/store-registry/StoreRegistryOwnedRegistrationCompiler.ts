import { IResource, IResourceWithConfig, RegisterableItem } from "../../defs";
import type { RunnerMode } from "../../types/runner";
import { VisibilityTracker } from "../VisibilityTracker";
import { CanonicalIdCompiler } from "./CanonicalIdCompiler";
import { createOwnerScope, type OwnerScope } from "./OwnerScope";
import { RegisterableKind, resolveRegisterableKind } from "./registerableKind";
import { StoreRegistryDefinitionCloner } from "./StoreRegistryDefinitionCloner";
import type { StoreRegistryAliasResolver } from "./StoreRegistryWriter.types";

type StoreGenericItemHandler = (item: RegisterableItem) => void;

export class StoreRegistryOwnedRegistrationCompiler {
  constructor(
    private readonly canonicalIdCompiler: CanonicalIdCompiler,
    private readonly aliasResolver: StoreRegistryAliasResolver,
    private readonly visibilityTracker: VisibilityTracker,
    private readonly definitionCloner: StoreRegistryDefinitionCloner,
  ) {}

  computeRegistrationDeeply<_C>(
    element: IResource<_C>,
    config: _C | undefined,
    runtimeMode: RunnerMode | undefined,
    storeGenericItem: StoreGenericItemHandler,
  ): void {
    const registerEntries =
      typeof element.register === "function"
        ? element.register(config as _C, runtimeMode as RunnerMode)
        : element.register;
    const items = registerEntries ?? [];
    this.assignNormalizedRegisterEntries(element, items);

    const ownerScope = createOwnerScope(element.id);
    const scopedItems = items.map((item) =>
      this.compileOwnedItem(ownerScope, item),
    );

    for (const item of scopedItems) {
      this.visibilityTracker.recordOwnership(element.id, item);
      const itemId = this.resolveRegisterableId(item);
      try {
        storeGenericItem(item);
      } catch (error) {
        if (itemId) {
          this.visibilityTracker.rollbackOwnershipTree(itemId);
        }
        throw error;
      }
    }
  }

  computeCanonicalId(
    ownerResourceId: string,
    ownerUsesFrameworkRootIds: boolean,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
    currentId: string,
  ): string {
    return this.canonicalIdCompiler.compute(
      {
        resourceId: ownerResourceId,
        usesFrameworkRootIds: ownerUsesFrameworkRootIds,
      },
      kind,
      currentId,
    );
  }

  compileOwnedDefinition(
    ownerResourceId: string,
    ownerUsesFrameworkRootIds: boolean,
    item: RegisterableItem,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
  ): RegisterableItem {
    return this.compileOwnedDefinitionWithScope(
      {
        resourceId: ownerResourceId,
        usesFrameworkRootIds: ownerUsesFrameworkRootIds,
      },
      item,
      kind,
    );
  }

  resolveRegisterableId(item: RegisterableItem): string | undefined {
    if (item === null || item === undefined) {
      return undefined;
    }

    if (resolveRegisterableKind(item) === RegisterableKind.ResourceWithConfig) {
      return (item as IResourceWithConfig<any, any, any>).resource.id;
    }

    if (typeof item === "object" && "id" in item) {
      return (item as { id: string }).id;
    }

    return undefined;
  }

  private assignNormalizedRegisterEntries<_C>(
    element: IResource<_C>,
    items: RegisterableItem[],
  ): void {
    const descriptor = Object.getOwnPropertyDescriptor(element, "register");

    if (descriptor && descriptor.writable === false) {
      return;
    }

    element.register = items;
  }

  private compileOwnedItem(
    ownerScope: OwnerScope,
    item: RegisterableItem,
  ): RegisterableItem {
    const kind = resolveRegisterableKind(item);
    if (!kind) {
      return item;
    }

    if (kind === RegisterableKind.ResourceWithConfig) {
      const withConfig = item as IResourceWithConfig<any, any, any>;
      const compiledResource = this.compileOwnedDefinitionWithScope(
        ownerScope,
        withConfig.resource as RegisterableItem,
        RegisterableKind.Resource,
      ) as IResource<any, any, any>;
      const compiledWithConfig = this.definitionCloner.cloneWithId(
        withConfig as IResourceWithConfig<any, any, any> & { id: string },
        compiledResource.id,
      ) as IResourceWithConfig<any, any, any>;
      compiledWithConfig.resource = compiledResource;

      this.aliasResolver.registerDefinitionAlias(item, compiledResource.id);
      this.aliasResolver.registerDefinitionAlias(
        withConfig.resource,
        compiledResource.id,
      );
      this.aliasResolver.registerDefinitionAlias(
        compiledWithConfig,
        compiledResource.id,
      );
      this.aliasResolver.registerDefinitionAlias(
        compiledWithConfig.resource,
        compiledResource.id,
      );
      return compiledWithConfig;
    }

    const compiled = this.compileOwnedDefinitionWithScope(
      ownerScope,
      item,
      kind,
    );
    const resolvedId = this.resolveRegisterableId(compiled)!;
    this.aliasResolver.registerDefinitionAlias(item, resolvedId);
    this.aliasResolver.registerDefinitionAlias(compiled, resolvedId);
    return compiled;
  }

  private compileOwnedDefinitionWithScope(
    ownerScope: OwnerScope,
    item: RegisterableItem,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
  ): RegisterableItem {
    const currentId = item.id;
    const nextId = this.canonicalIdCompiler.compute(
      ownerScope,
      kind,
      currentId,
    );
    if (nextId === currentId) {
      return item;
    }

    return this.definitionCloner.cloneWithId(
      item as RegisterableItem & { id: string },
      nextId,
    );
  }
}
