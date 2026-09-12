import type { RegisterableItem } from "../../defs";
import { isOptional, isTagStartup } from "../../define";
import { runtimeInspectionTargetNotFoundError } from "../../errors";
import type {
  IRuntimeDefinitionInspection,
  IRuntimeGraphSnapshot,
  IRuntimeInspectionDependency,
  IRuntimeInspector,
  RuntimeInspectionKind,
} from "../../types/runtimeInspection";
import { deepFreeze } from "../../tools/deepFreeze";
import type { Store } from "../store/Store";
import { RuntimeMiddlewareInspector } from "./RuntimeMiddlewareInspector";

type InspectableDefinition = {
  readonly id: string;
  readonly dependencies?: object;
  readonly middleware?: readonly { id: string }[];
  readonly tags?: readonly { id: string }[];
};

type CollectedDefinition = {
  readonly kind: RuntimeInspectionKind;
  readonly definition: InspectableDefinition;
};

/**
 * Builds detached, immutable views of a runtime's compiled definition graph.
 * The Store remains hard-private so tooling cannot reach mutation surfaces.
 */
export class RuntimeInspector implements IRuntimeInspector {
  readonly #store: Store;
  readonly #middlewareInspector: RuntimeMiddlewareInspector;
  #lockedSnapshot?: IRuntimeGraphSnapshot;

  public constructor(store: Store) {
    this.#store = store;
    this.#middlewareInspector = new RuntimeMiddlewareInspector(store);
  }

  /** Returns an immutable snapshot ordered by canonical definition id. */
  public snapshot(): IRuntimeGraphSnapshot {
    if (this.#lockedSnapshot) {
      return this.#lockedSnapshot;
    }

    const rootId = this.#store.root?.resource.id;
    const definitions = this.collectDefinitions()
      .map(({ kind, definition }) =>
        this.inspectDefinition(kind, definition, rootId),
      )
      .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));
    const snapshot = deepFreeze({
      rootId,
      lifecycle: this.#store.getLifecycleInspection(),
      definitions,
    });

    if (this.#store.isLocked) {
      this.#lockedSnapshot = snapshot;
    }

    return snapshot;
  }

  /** Explains a registered definition reference or canonical id. */
  public explain(
    definitionOrCanonicalId: RegisterableItem | string,
  ): IRuntimeDefinitionInspection {
    const canonicalId = this.#store.lookup.tryCanonicalId(
      definitionOrCanonicalId,
    );
    const definition = canonicalId
      ? this.snapshot().definitions.find(
          (candidate) => candidate.canonicalId === canonicalId,
        )
      : undefined;

    if (!definition) {
      return runtimeInspectionTargetNotFoundError.throw({
        targetId:
          this.#store.lookup.extractRequestedId(definitionOrCanonicalId) ??
          "<unknown>",
      });
    }

    return definition;
  }

  private inspectDefinition(
    kind: RuntimeInspectionKind,
    definition: InspectableDefinition,
    rootId: string | undefined,
  ): IRuntimeDefinitionInspection {
    const sourceIds = this.#store.getDefinitionSourceIds(definition.id);
    const sourceId =
      sourceIds.find((candidate) => candidate !== definition.id) ??
      sourceIds[0];
    const rootAccess = rootId
      ? this.inspectRootAccess(definition.id, rootId)
      : undefined;

    return deepFreeze({
      kind,
      canonicalId: definition.id,
      sourceId,
      ownerId: this.#store.getOwnerResourceId(definition.id),
      dependenciesResolved: typeof definition.dependencies !== "function",
      dependencies: this.inspectDependencies(definition),
      middleware: this.#middlewareInspector.inspect(definition),
      tagIds: this.inspectTags(definition),
      override: this.#store.getOverrideInspection(definition.id),
      rootAccess,
    });
  }

  private inspectDependencies(
    definition: InspectableDefinition,
  ): IRuntimeInspectionDependency[] {
    if (
      !definition.dependencies ||
      typeof definition.dependencies === "function"
    ) {
      return [];
    }

    const dependencies: IRuntimeInspectionDependency[] = [];
    for (const [key, reference] of Object.entries(definition.dependencies)) {
      const canonicalId = this.resolveDependencyId(reference);
      if (canonicalId) {
        dependencies.push({ key, id: canonicalId });
      }
    }
    return dependencies;
  }

  private resolveDependencyId(reference: unknown): string | null {
    const optionalTarget = isOptional(reference) ? reference.inner : reference;
    const target = isTagStartup(optionalTarget)
      ? optionalTarget.tag
      : optionalTarget;
    return this.#store.lookup.tryCanonicalId(target);
  }

  private inspectTags(definition: InspectableDefinition): string[] {
    const tagIds: string[] = [];
    for (const tag of definition.tags ?? []) {
      const id = this.#store.lookup.tryCanonicalId(tag);
      if (id) {
        tagIds.push(id);
      }
    }
    return tagIds;
  }

  private inspectRootAccess(canonicalId: string, rootId: string) {
    const { accessible, exportedIds } = this.#store.getRootAccessInfo(
      canonicalId,
      rootId,
    );
    return {
      accessible,
      exportsDeclared: this.#store.hasExportsDeclaration(rootId),
      directlyExported: exportedIds.includes(canonicalId),
    };
  }

  private collectDefinitions(): CollectedDefinition[] {
    return [
      ...Array.from(this.#store.resources.values(), ({ resource }) => ({
        kind: "resource" as const,
        definition: resource,
      })),
      ...Array.from(this.#store.tasks.values(), ({ task }) => ({
        kind: "task" as const,
        definition: task,
      })),
      ...Array.from(this.#store.events.values(), ({ event }) => ({
        kind: "event" as const,
        definition: event,
      })),
      ...Array.from(this.#store.hooks.values(), ({ hook }) => ({
        kind: "hook" as const,
        definition: hook,
      })),
      ...Array.from(this.#store.taskMiddlewares.values(), ({ middleware }) => ({
        kind: "taskMiddleware" as const,
        definition: middleware,
      })),
      ...Array.from(
        this.#store.resourceMiddlewares.values(),
        ({ middleware }) => ({
          kind: "resourceMiddleware" as const,
          definition: middleware,
        }),
      ),
      ...Array.from(this.#store.tags.values(), (definition) => ({
        kind: "tag" as const,
        definition,
      })),
      ...Array.from(this.#store.asyncContexts.values(), (definition) => ({
        kind: "asyncContext" as const,
        definition,
      })),
      ...Array.from(this.#store.errors.values(), (definition) => ({
        kind: "error" as const,
        definition,
      })),
    ];
  }
}
