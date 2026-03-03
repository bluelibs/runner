import {
  IHook,
  IResource,
  IResourceMiddleware,
  IResourceWithConfig,
  ITask,
  ITaskMiddleware,
  RegisterableItems,
  symbolOverrideTargetDefinition,
} from "../defs";
import * as utils from "../define";
import {
  overrideDefinitionRequiredError,
  overrideDuplicateTargetError,
  overrideTargetNotRegisteredError,
  unknownItemTypeError,
} from "../errors";
import { StoreRegistry } from "./StoreRegistry";

type OverrideTargetType =
  | "Task"
  | "Resource"
  | "Task middleware"
  | "Resource middleware"
  | "Hook";

type SupportedOverride =
  | ITask
  | IResource
  | ITaskMiddleware
  | IResourceMiddleware
  | IResourceWithConfig
  | IHook;

export class OverrideManager {
  public overrides: Map<string, SupportedOverride> = new Map();

  public overrideRequests: Set<{
    source: string;
    override: RegisterableItems;
  }> = new Set();

  constructor(private readonly registry: StoreRegistry) {}

  private assertOverrideValuesShape(): void {
    for (const override of this.overrides.values()) {
      this.toSupportedOverride(override);
    }
  }

  private toSupportedOverride(override: RegisterableItems): SupportedOverride {
    if (
      utils.isTask(override) ||
      utils.isResource(override) ||
      utils.isTaskMiddleware(override) ||
      utils.isResourceMiddleware(override) ||
      utils.isResourceWithConfig(override) ||
      utils.isHook(override)
    ) {
      return override;
    }

    return unknownItemTypeError.throw({ item: override });
  }

  private resolveRegistryDefinitionId(reference: unknown): string | undefined {
    return this.registry.resolveDefinitionId(reference);
  }

  private getOverrideId(override: SupportedOverride): string {
    if (utils.isResourceWithConfig(override)) {
      return override.resource.id;
    }
    return override.id;
  }

  private getOverrideType(override: SupportedOverride): OverrideTargetType {
    if (utils.isTask(override)) return "Task";
    if (utils.isResource(override) || utils.isResourceWithConfig(override)) {
      return "Resource";
    }
    if (utils.isTaskMiddleware(override)) return "Task middleware";
    if (utils.isResourceMiddleware(override)) return "Resource middleware";
    return "Hook";
  }

  private getOverrideTargetReference(override: SupportedOverride): unknown {
    const definition = utils.isResourceWithConfig(override)
      ? override.resource
      : override;

    const maybeTarget = (definition as unknown as Record<symbol, unknown>)[
      symbolOverrideTargetDefinition
    ];

    return maybeTarget ?? definition;
  }

  private getOverrideTargetId(
    ownerResourceId: string,
    override: SupportedOverride,
  ): string {
    const targetReference = this.getOverrideTargetReference(override);
    const targetId = this.resolveRegistryDefinitionId(targetReference);
    if (!targetId) {
      return overrideTargetNotRegisteredError.throw({
        targetId: this.getOverrideId(override),
        targetType: this.getOverrideType(override),
        sources: [ownerResourceId],
      });
    }

    return targetId;
  }

  private getOverrideSourcesById(targetId: string): string[] {
    const sources = new Set<string>();
    for (const request of this.overrideRequests.values()) {
      try {
        const override = this.toSupportedOverride(request.override);
        const id = this.getOverrideTargetId(request.source, override);
        if (id === targetId) {
          sources.add(request.source);
        }
      } catch {
        // Ignore malformed entries when collecting diagnostics.
      }
    }

    return Array.from(sources.values());
  }

  private isOverrideBranded(override: RegisterableItems): boolean {
    if (utils.isResourceWithConfig(override)) {
      return utils.isOverrideDefinition(override.resource);
    }
    return utils.isOverrideDefinition(override);
  }

  private getMaybeOverrideId(override: RegisterableItems): string | undefined {
    if (utils.isResourceWithConfig(override)) {
      return override.resource.id;
    }
    if (override && typeof override === "object" && "id" in override) {
      return (override as { id: string }).id;
    }
    return undefined;
  }

  storeOverridesDeeply<C>(
    element: IResource<C, any, any>,
    visited: Set<string> = new Set(),
  ) {
    if (visited.has(element.id)) {
      return;
    }

    visited.add(element.id);

    element.overrides.forEach((override) => {
      if (!override) {
        return;
      }
      if (!this.isOverrideBranded(override)) {
        overrideDefinitionRequiredError.throw({
          sourceId: element.id,
          receivedId: this.getMaybeOverrideId(override),
        });
      }

      const supportedOverride = this.toSupportedOverride(override);
      if (utils.isResource(supportedOverride)) {
        this.storeOverridesDeeply(supportedOverride, visited);
      } else if (utils.isResourceWithConfig(supportedOverride)) {
        this.storeOverridesDeeply(supportedOverride.resource, visited);
      }

      const targetId = this.getOverrideTargetId(element.id, supportedOverride);
      this.overrideRequests.add({ source: element.id, override });
      if (this.overrides.has(targetId)) {
        overrideDuplicateTargetError.throw({
          targetId: this.getOverrideId(supportedOverride),
          sources: this.getOverrideSourcesById(targetId),
        });
      }
      this.overrides.set(targetId, supportedOverride);
    });
  }

  processOverrides() {
    // Fail fast if the override map was mutated unexpectedly.
    this.assertOverrideValuesShape();

    // If we are trying to use override on something that wasn't previously registered, we throw an error.
    for (const [targetId, override] of this.overrides.entries()) {
      const supportedOverride = this.toSupportedOverride(override);
      const targetType = this.getOverrideType(supportedOverride);
      let hasAnyItem: boolean;
      switch (targetType) {
        case "Task":
          hasAnyItem = this.registry.tasks.has(targetId);
          break;
        case "Resource":
          hasAnyItem = this.registry.resources.has(targetId);
          break;
        case "Task middleware":
          hasAnyItem = this.registry.taskMiddlewares.has(targetId);
          break;
        case "Resource middleware":
          hasAnyItem = this.registry.resourceMiddlewares.has(targetId);
          break;
        case "Hook":
          hasAnyItem = this.registry.hooks.has(targetId);
          break;
      }

      if (!hasAnyItem) {
        overrideTargetNotRegisteredError.throw({
          targetId: this.getOverrideId(supportedOverride),
          targetType,
          sources: this.getOverrideSourcesById(targetId),
        });
      }
    }

    // Validate again before writes in case third-party code mutates the map during validation.
    this.assertOverrideValuesShape();

    for (const [targetId, override] of this.overrides.entries()) {
      const supportedOverride = this.toSupportedOverride(override);
      if (utils.isTask(supportedOverride)) {
        const taskOverride = supportedOverride as ITask;
        this.registry.storeTask({ ...taskOverride, id: targetId }, "override");
        continue;
      }
      if (utils.isResource(supportedOverride)) {
        const resourceOverride = supportedOverride as IResource;
        this.registry.storeResource(
          { ...resourceOverride, id: targetId },
          "override",
        );
        continue;
      }
      if (utils.isTaskMiddleware(supportedOverride)) {
        const middlewareOverride = supportedOverride as ITaskMiddleware;
        this.registry.storeTaskMiddleware(
          { ...middlewareOverride, id: targetId },
          "override",
        );
        continue;
      }
      if (utils.isResourceMiddleware(supportedOverride)) {
        const middlewareOverride = supportedOverride as IResourceMiddleware;
        this.registry.storeResourceMiddleware(
          { ...middlewareOverride, id: targetId },
          "override",
        );
        continue;
      }
      if (utils.isResourceWithConfig(supportedOverride)) {
        const resourceOverride = supportedOverride as IResourceWithConfig;
        this.registry.storeResourceWithConfig(
          {
            ...resourceOverride,
            id: targetId,
            resource: { ...resourceOverride.resource, id: targetId },
          },
          "override",
        );
        continue;
      }
      const hookOverride = supportedOverride as IHook;
      this.registry.storeHook({ ...hookOverride, id: targetId }, "override");
    }
  }
}
