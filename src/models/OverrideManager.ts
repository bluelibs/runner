import { IResource, RegisterableItem } from "../defs";
import * as utils from "../define";
import {
  overrideDefinitionRequiredError,
  overrideOutOfScopeError,
  overrideTargetNotRegisteredError,
} from "../errors";
import { FRAMEWORK_SYSTEM_RESOURCE_ID } from "./createSyntheticFrameworkRoot";
import { storeDefinitionOverride } from "./overrides/storeDefinitionOverride";
import { ScopedResourceOverrides } from "./overrides/ScopedResourceOverrides";
import { throwAccessViolation } from "./visibility-tracker/throwAccessViolation";
import {
  toSupportedOverride,
  getOverrideType,
  getOverrideTargetReference,
  SupportedOverride,
} from "./overrides/overrideDefinition";
import { StoreRegistry } from "./store/StoreRegistry";
import {
  selectOverrideCandidate,
  OverrideCandidate,
} from "./overrides/selectOverrideCandidate";

export type OverrideInspection = {
  /** Canonical id whose registered behavior was replaced. */
  baseCanonicalId: string;
  /** Source id carried by the base definition before canonical compilation. */
  baseSourceId: string;
  /** Source id carried by the winning identity-preserving override. */
  winnerSourceId: string;
  /** Canonical resource id whose override declaration won. */
  declaredByResourceId: string;
};

export class OverrideManager {
  public overrides: Map<string, SupportedOverride> = new Map();

  public overrideRequests: Array<{
    source: string;
    override: RegisterableItem;
  }> = [];

  private readonly overrideCandidatesByTarget = new Map<
    string,
    OverrideCandidate[]
  >();
  private readonly overrideWinnerSources = new Map<string, string>();
  private overrideBaseIds: Map<string, string> | undefined;

  constructor(private readonly registry: StoreRegistry) {}

  /** Returns detached winner metadata for runtime tooling. @internal */
  public getOverrideInspection(
    targetId: string,
  ): OverrideInspection | undefined {
    const winner = this.overrides.get(targetId);
    const declaredByResourceId = this.overrideWinnerSources.get(targetId);
    if (!winner || !declaredByResourceId) {
      return undefined;
    }
    const baseReference = getOverrideTargetReference(winner);

    return {
      baseCanonicalId: this.overrideBaseIds?.get(targetId) ?? targetId,
      baseSourceId: baseReference.id,
      winnerSourceId: winner.id,
      declaredByResourceId,
    };
  }

  private getOverrideTargetId(
    ownerResourceId: string,
    override: SupportedOverride,
  ): string {
    const targetReference = getOverrideTargetReference(override);
    const targetId = this.registry.resolveDefinitionId(targetReference);
    if (!targetId) {
      return overrideTargetNotRegisteredError.throw({
        targetId: override.id,
        targetType: getOverrideType(override),
        sources: [ownerResourceId],
      });
    }

    return targetId;
  }

  private getOverrideSourcesById(targetId: string): string[] {
    const candidates = this.overrideCandidatesByTarget.get(targetId);
    if (candidates && candidates.length > 0) {
      return Array.from(
        new Set(candidates.map((candidate) => candidate.source)),
      );
    }

    const sources = new Set<string>();
    for (const request of this.overrideRequests) {
      try {
        const override = toSupportedOverride(request.override);
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
      targetId: override.id,
      targetType: getOverrideType(override),
      ownerResourceId:
        this.registry.visibilityTracker.getOwnerResourceId(targetId),
    });
  }

  private isOverrideBranded(override: RegisterableItem): boolean {
    return utils.isOverrideDefinition(override);
  }

  private getMaybeOverrideId(override: RegisterableItem): string | undefined {
    if (override && typeof override === "object" && "id" in override) {
      return (override as { id: string }).id;
    }
    return undefined;
  }

  private storeOverrideCandidate(
    targetId: string,
    candidate: OverrideCandidate,
  ): void {
    const candidates = this.overrideCandidatesByTarget.get(targetId) ?? [];
    const winner = selectOverrideCandidate(
      this.registry,
      candidates,
      candidate,
    );
    candidates.push(candidate);
    this.overrideCandidatesByTarget.set(targetId, candidates);
    this.overrides.set(targetId, winner.override);
    this.overrideWinnerSources.set(targetId, winner.source);
  }

  storeOverridesDeeply<C>(
    element: IResource<C, any, any>,
    visited: Set<string> = new Set(),
  ) {
    if (visited.has(element.id)) {
      return;
    }

    visited.add(element.id);

    const overrides = element.overrides as Array<RegisterableItem>;
    overrides.forEach((override) => {
      if (!override) {
        return;
      }
      if (!this.isOverrideBranded(override)) {
        overrideDefinitionRequiredError.throw({
          sourceId: element.id,
          receivedId: this.getMaybeOverrideId(override),
        });
      }

      const supportedOverride = toSupportedOverride(override);
      const targetId = this.getOverrideTargetId(element.id, supportedOverride);
      if (this.hasRegisteredOverrideTarget(targetId, supportedOverride)) {
        if (utils.isResource(supportedOverride)) {
          if (
            this.registry.visibilityTracker.isWithinResourceSubtree(
              FRAMEWORK_SYSTEM_RESOURCE_ID,
              targetId,
            )
          )
            this.assertOverrideWithinDeclaringSubtree(
              element.id,
              targetId,
              supportedOverride,
            );
          const violation = this.registry.visibilityTracker.getAccessViolation(
            targetId,
            element.id,
            "dependencies",
          );
          if (violation) {
            throwAccessViolation({
              violation,
              targetId,
              targetType: "Resource",
              consumerId: element.id,
              consumerType: "Resource",
            });
          }
        } else {
          this.assertOverrideWithinDeclaringSubtree(
            element.id,
            targetId,
            supportedOverride,
          );
        }
      }
      this.overrideRequests.push({ source: element.id, override });
      this.storeOverrideCandidate(targetId, {
        source: element.id,
        override: supportedOverride,
      });
    });
  }

  processOverrides() {
    if (this.overrides.size === 0) return;

    // Validate all targets exist before writing any overrides.
    for (const [targetId, override] of this.overrides.entries()) {
      if (!this.hasRegisteredOverrideTarget(targetId, override)) {
        overrideTargetNotRegisteredError.throw({
          targetId: override.id,
          targetType: getOverrideType(override),
          sources: this.getOverrideSourcesById(targetId),
        });
      }
    }

    const resourceOverrides = new ScopedResourceOverrides(
      this.registry,
      (instanceId, targetId, source, override) => {
        this.overrides.set(instanceId, override);
        this.overrideWinnerSources.set(instanceId, source);
        (this.overrideBaseIds ??= new Map()).set(instanceId, targetId);
      },
    );
    for (const [targetId, override] of [...this.overrides.entries()]) {
      if (utils.isResource(override)) {
        const candidates = this.overrideCandidatesByTarget.get(targetId);
        if (candidates) {
          this.overrides.delete(targetId);
          this.overrideWinnerSources.delete(targetId);
          resourceOverrides.add(
            targetId,
            candidates.filter(
              (
                candidate,
              ): candidate is { source: string; override: IResource } =>
                utils.isResource(candidate.override),
            ),
          );
          continue;
        }
      }
      storeDefinitionOverride(this.registry, targetId, override);
    }
    resourceOverrides.compile();
  }
}
