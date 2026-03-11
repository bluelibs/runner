import {
  IHook,
  IResource,
  IResourceMiddleware,
  ITask,
  ITaskMiddleware,
  RegisterableItems,
  symbolOverrideTargetDefinition,
} from "../defs";
import * as utils from "../define";
import {
  overrideDefinitionRequiredError,
  overrideDuplicateTargetError,
  overrideOutOfScopeError,
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
  | IHook;

export class OverrideManager {
  public overrides: Map<string, SupportedOverride> = new Map();

  public overrideRequests: Array<{
    source: string;
    override: RegisterableItems;
  }> = [];

  constructor(private readonly registry: StoreRegistry) {}

  private toSupportedOverride(override: RegisterableItems): SupportedOverride {
    if (
      utils.isTask(override) ||
      utils.isResource(override) ||
      utils.isTaskMiddleware(override) ||
      utils.isResourceMiddleware(override) ||
      utils.isHook(override)
    ) {
      return override;
    }

    return unknownItemTypeError.throw({ item: override });
  }

  private getOverrideId(override: SupportedOverride): string {
    return override.id;
  }

  private getOverrideType(override: SupportedOverride): OverrideTargetType {
    if (utils.isTask(override)) return "Task";
    if (utils.isResource(override)) {
      return "Resource";
    }
    if (utils.isTaskMiddleware(override)) return "Task middleware";
    if (utils.isResourceMiddleware(override)) return "Resource middleware";
    return "Hook";
  }

  private getOverrideTargetReference(override: SupportedOverride): unknown {
    const maybeTarget = (override as unknown as Record<symbol, unknown>)[
      symbolOverrideTargetDefinition
    ];

    return maybeTarget ?? override;
  }

  private getOverrideTargetId(
    ownerResourceId: string,
    override: SupportedOverride,
  ): string {
    const targetReference = this.getOverrideTargetReference(override);
    const targetId = this.registry.resolveDefinitionId(targetReference);
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
    for (const request of this.overrideRequests) {
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

  private hasRegisteredOverrideTarget(
    targetId: string,
    override: SupportedOverride,
  ): boolean {
    if (utils.isTask(override)) return this.registry.tasks.has(targetId);
    if (utils.isResource(override))
      return this.registry.resources.has(targetId);
    if (utils.isTaskMiddleware(override))
      return this.registry.taskMiddlewares.has(targetId);
    if (utils.isResourceMiddleware(override))
      return this.registry.resourceMiddlewares.has(targetId);
    return this.registry.hooks.has(targetId);
  }

  private assertOverrideWithinDeclaringSubtree(
    sourceResourceId: string,
    targetId: string,
    override: SupportedOverride,
  ): void {
    if (
      this.registry.visibilityTracker.isWithinResourceSubtree(
        sourceResourceId,
        targetId,
      )
    ) {
      return;
    }

    overrideOutOfScopeError.throw({
      sourceId: sourceResourceId,
      targetId: this.getOverrideId(override),
      targetType: this.getOverrideType(override),
      ownerResourceId:
        this.registry.visibilityTracker.getOwnerResourceId(targetId),
    });
  }

  private isOverrideBranded(override: RegisterableItems): boolean {
    return utils.isOverrideDefinition(override);
  }

  private getMaybeOverrideId(override: RegisterableItems): string | undefined {
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
      }

      const targetId = this.getOverrideTargetId(element.id, supportedOverride);
      if (this.hasRegisteredOverrideTarget(targetId, supportedOverride)) {
        this.assertOverrideWithinDeclaringSubtree(
          element.id,
          targetId,
          supportedOverride,
        );
      }
      this.overrideRequests.push({ source: element.id, override });
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
    // Validate all targets exist before writing any overrides.
    for (const [targetId, override] of this.overrides.entries()) {
      if (!this.hasRegisteredOverrideTarget(targetId, override)) {
        overrideTargetNotRegisteredError.throw({
          targetId: this.getOverrideId(override),
          targetType: this.getOverrideType(override),
          sources: this.getOverrideSourcesById(targetId),
        });
      }
    }

    for (const [targetId, override] of this.overrides.entries()) {
      this.storeOverride(targetId, override);
    }
  }

  private storeOverride(targetId: string, override: SupportedOverride): void {
    if (utils.isTask(override)) {
      this.registry.storeTask({ ...override, id: targetId }, "override");
      return;
    }
    if (utils.isResource(override)) {
      this.registry.storeResource({ ...override, id: targetId }, "override");
      return;
    }
    if (utils.isTaskMiddleware(override)) {
      this.registry.storeTaskMiddleware(
        { ...override, id: targetId },
        "override",
      );
      return;
    }
    if (utils.isResourceMiddleware(override)) {
      this.registry.storeResourceMiddleware(
        { ...override, id: targetId },
        "override",
      );
      return;
    }
    this.registry.storeHook(
      { ...(override as IHook), id: targetId },
      "override",
    );
  }
}
