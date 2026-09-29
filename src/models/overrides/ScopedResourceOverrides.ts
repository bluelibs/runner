import type { IResource, ResourceStoreElementType } from "../../defs";
import { isOptional, isResource } from "../../define";
import { StoreRegistry } from "../store/StoreRegistry";
import {
  createScopedResource,
  replaceResourceBehavior,
} from "./resourceInstances";
import { dependencyDefinitions } from "./dependencyDefinitions";

export type ResourceOverrideCandidate = {
  source: string;
  override: IResource;
};

type ResourcePlan = {
  base: ResourceStoreElementType;
  candidates: ResourceOverrideCandidate[];
  instances: Map<ResourceOverrideCandidate | undefined, IResource>;
};

/** Compiles resource substitutions before graph validation and initialization. */
export class ScopedResourceOverrides {
  private readonly plans = new Map<string, ResourcePlan>();
  private readonly consumerScopes = new Map<string, string>();

  constructor(
    private readonly registry: StoreRegistry,
    private readonly recordWinner: (
      instanceId: string,
      targetId: string,
      source: string,
      override: IResource,
    ) => void,
  ) {}

  add(targetId: string, candidates: ResourceOverrideCandidate[]): void {
    const entry = this.registry.resources.get(targetId)!;
    // Retain the compiled structure; an override only replaces lifecycle behavior.
    const base = { ...entry, resource: { ...entry.resource } };
    this.plans.set(targetId, { base, candidates, instances: new Map() });
  }

  compile(): void {
    if (this.plans.size === 0) return;
    for (const [targetId, plan] of this.plans) {
      const winner = this.select(plan, targetId);
      const entry = this.registry.resources.get(targetId)!;
      if (winner) {
        entry.resource = replaceResourceBehavior(
          plan.base.resource,
          winner.override,
        );
        this.recordWinner(targetId, targetId, winner.source, winner.override);
      }
      plan.instances.set(winner, entry.resource);
      for (const candidate of plan.candidates) {
        this.instance(plan, candidate);
      }
    }

    // Resource iteration remains live because resolving a fallback can add an
    // original instance needed by a consumer outside the overriding subtree.
    for (const definition of dependencyDefinitions(this.registry)) {
      const dependencies = definition.dependencies;
      if (!dependencies || typeof dependencies === "function") continue;
      const scope = this.consumerScopes.get(definition.id) ?? definition.id;
      definition.dependencies = Object.fromEntries(
        Object.entries(dependencies).map(([key, dependency]) => {
          const candidate = isOptional(dependency)
            ? dependency.inner
            : dependency;
          if (!isResource(candidate)) return [key, dependency];
          const targetId = this.registry.resolveDefinitionId(candidate)!;
          const plan = this.plans.get(targetId);
          if (!plan) return [key, dependency];
          const resource = this.instance(plan, this.select(plan, scope));
          return [
            key,
            isOptional(dependency)
              ? { ...dependency, inner: resource }
              : resource,
          ];
        }),
      );
    }
  }

  private select(
    plan: ResourcePlan,
    consumerId: string,
  ): ResourceOverrideCandidate | undefined {
    let winner: ResourceOverrideCandidate | undefined;
    const visibility = this.registry.visibilityTracker;
    for (const candidate of plan.candidates) {
      if (!visibility.isWithinResourceSubtree(candidate.source, consumerId))
        continue;
      if (
        !winner ||
        visibility.isWithinResourceSubtree(winner.source, candidate.source)
      ) {
        winner = candidate;
      }
    }
    return winner;
  }

  private instance(
    plan: ResourcePlan,
    candidate: ResourceOverrideCandidate | undefined,
  ): IResource {
    const existing = plan.instances.get(candidate);
    if (existing) return existing;
    const targetId = plan.base.resource.id;
    const scope =
      candidate?.source ??
      this.registry.visibilityTracker.getOwnerResourceId(targetId)!;
    const id = `${scope}.resources.${candidate ? "overrides" : "original"}.${targetId}`;
    const resource = createScopedResource(
      this.registry,
      plan.base,
      id,
      scope,
      candidate?.override,
    );
    plan.instances.set(candidate, resource);
    this.consumerScopes.set(id, candidate?.source ?? targetId);
    if (candidate)
      this.recordWinner(id, targetId, candidate.source, candidate.override);
    return resource;
  }
}
