import type { IRuntime } from "./runner";
import type { RegisterableItem } from "./utilities";

/** Definition kinds exposed by the immutable runtime graph inspector. */
export type RuntimeInspectionKind =
  | "resource"
  | "task"
  | "event"
  | "hook"
  | "taskMiddleware"
  | "resourceMiddleware"
  | "tag"
  | "asyncContext"
  | "error";

/** A dependency edge resolved to its canonical runtime id. */
export interface IRuntimeInspectionDependency {
  /** Dependency-map key declared by the inspected definition. */
  readonly key: string;
  /** Canonical id of the registered dependency. */
  readonly id: string;
}

/** How middleware became part of the effective execution chain. */
export type RuntimeInspectionMiddlewareOrigin = "local" | "subtree";

/** A middleware attachment in effective execution order. */
export interface IRuntimeInspectionMiddleware {
  /** Canonical id of the registered middleware. */
  readonly id: string;
  /** Zero-based execution order; lower values wrap higher values. */
  readonly order: number;
  /** Whether the middleware is local or inherited from subtree policy. */
  readonly origin: RuntimeInspectionMiddlewareOrigin;
  /** Canonical id of the task/resource or subtree-policy resource that applied it. */
  readonly sourceId: string;
}

/** Root runtime API visibility for one definition. */
export interface IRuntimeInspectionRootAccess {
  /** Whether the root operator API can access the definition. */
  readonly accessible: boolean;
  /** Whether the root resource declared an explicit export surface. */
  readonly exportsDeclared: boolean;
  /** Whether the definition appears directly in the root export list. */
  readonly directlyExported: boolean;
}

/** Compiled winner information for a behavior-preserving override. */
export interface IRuntimeInspectionOverride {
  /** Canonical id whose registered behavior was replaced. */
  readonly baseCanonicalId: string;
  /** Source id carried by the base definition before canonical compilation. */
  readonly baseSourceId: string;
  /** Source id carried by the winning override; overrides intentionally preserve identity. */
  readonly winnerSourceId: string;
  /** Canonical resource id whose override declaration won. */
  readonly declaredByResourceId: string;
}

/** One resource lifecycle wave in execution order. */
export interface IRuntimeInspectionLifecycleWave {
  /** Zero-based wave order within its lifecycle phase. */
  readonly order: number;
  /** Whether resources in this wave execute concurrently. */
  readonly parallel: boolean;
  /** Canonical resource ids participating in this wave. */
  readonly resourceIds: readonly string[];
}

/** Reliable compiled resource ordering used by ready, cooldown, and dispose. */
export interface IRuntimeInspectionLifecycle {
  /** Dependency-first waves used by resource ready(). */
  readonly readyWaves: readonly IRuntimeInspectionLifecycleWave[];
  /** Dependent-first waves shared by resource cooldown() and dispose(). */
  readonly shutdownWaves: readonly IRuntimeInspectionLifecycleWave[];
}

/** Immutable explanation of one registered runtime definition. */
export interface IRuntimeDefinitionInspection {
  /** Registered definition kind. */
  readonly kind: RuntimeInspectionKind;
  /** Canonical id assigned by the compiled runtime graph. */
  readonly canonicalId: string;
  /** Original definition id recorded before canonical compilation, when known. */
  readonly sourceId?: string;
  /** Canonical id of the resource that owns this definition, when recorded. */
  readonly ownerId?: string;
  /** Whether a dependency factory has been resolved into its keyed map. */
  readonly dependenciesResolved: boolean;
  /** Declared dependencies resolved to canonical ids. */
  readonly dependencies: readonly IRuntimeInspectionDependency[];
  /** Effective task/resource middleware, including inherited subtree policy. */
  readonly middleware: readonly IRuntimeInspectionMiddleware[];
  /** Canonical ids of tags attached to the definition. */
  readonly tagIds: readonly string[];
  /** Compiled override winner information when this definition was overridden. */
  readonly override?: IRuntimeInspectionOverride;
  /** Root operator visibility and export status, when a root is available. */
  readonly rootAccess?: IRuntimeInspectionRootAccess;
}

/** Immutable snapshot of the compiled runtime graph. */
export interface IRuntimeGraphSnapshot {
  /** Canonical id of the runtime root resource, when bootstrapping has set it. */
  readonly rootId?: string;
  /** Resource lifecycle ordering retained by the compiled runtime. */
  readonly lifecycle: IRuntimeInspectionLifecycle;
  /** All registered runtime definitions ordered by canonical id. */
  readonly definitions: readonly IRuntimeDefinitionInspection[];
}

/** Read-only tooling surface for inspecting a compiled runtime graph. */
export interface IRuntimeInspector {
  /** Returns an immutable snapshot of every registered definition. */
  snapshot(): IRuntimeGraphSnapshot;
  /** Explains one registered definition or canonical id. */
  explain(
    definitionOrCanonicalId: RegisterableItem | string,
  ): IRuntimeDefinitionInspection;
}

/** Runtime contract with the additive compiled-graph inspection surface. */
export interface IInspectableRuntime<V = unknown> extends IRuntime<V> {
  /** Returns the stable, read-only inspector for this runtime graph. */
  inspect(): IRuntimeInspector;
}
