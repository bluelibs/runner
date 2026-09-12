import { isResource, isTask } from "../../define";
import type {
  IResource,
  IResourceMiddleware,
  ITask,
  ITaskMiddleware,
} from "../../defs";
import type { IRuntimeInspectionMiddleware } from "../../types/runtimeInspection";
import {
  resolveApplicableSubtreeResourceMiddlewareEntries,
  resolveApplicableSubtreeTaskMiddlewareEntries,
} from "../../tools/subtreeMiddleware";
import { MiddlewareResolver } from "../middleware/MiddlewareResolver";
import type { Store } from "../store/Store";

type MiddlewareAnnotation = Pick<
  IRuntimeInspectionMiddleware,
  "origin" | "sourceId"
>;

/** Resolves effective middleware while retaining where each layer came from. */
export class RuntimeMiddlewareInspector {
  readonly #store: Store;
  readonly #resolver: MiddlewareResolver;

  /** Creates an inspector bound to one isolated runtime Store. */
  public constructor(store: Store) {
    this.#store = store;
    this.#resolver = new MiddlewareResolver(store);
  }

  /** Returns middleware layers in their effective runtime execution order. */
  public inspect(definition: object): IRuntimeInspectionMiddleware[] {
    if (isTask(definition)) {
      return this.inspectTask(definition);
    }
    if (isResource(definition)) {
      return this.inspectResource(definition);
    }
    return [];
  }

  private inspectTask(
    task: ITask<any, any, any, any, any, any>,
  ): IRuntimeInspectionMiddleware[] {
    const subtreeEntries = resolveApplicableSubtreeTaskMiddlewareEntries(
      this.createSubtreeLookup(),
      task,
    );
    const annotations: MiddlewareAnnotation[] = [
      ...subtreeEntries.map(({ ownerResourceId }) => ({
        origin: "subtree" as const,
        sourceId: ownerResourceId,
      })),
      ...task.middleware.map(() => ({
        origin: "local" as const,
        sourceId: task.id,
      })),
    ];
    const applicable = this.#resolver.getApplicableTaskMiddlewares(task);
    const effective = this.#resolver.applyRpcLanePolicyFilter(task, applicable);

    return this.annotateFilteredMiddleware(effective, applicable, annotations);
  }

  private inspectResource(
    resource: IResource<any, any, any, any, any, any, any>,
  ): IRuntimeInspectionMiddleware[] {
    const subtreeEntries = resolveApplicableSubtreeResourceMiddlewareEntries(
      this.createSubtreeLookup(),
      resource,
    );
    const annotations: MiddlewareAnnotation[] = [
      ...subtreeEntries.map(({ ownerResourceId }) => ({
        origin: "subtree" as const,
        sourceId: ownerResourceId,
      })),
      ...resource.middleware.map(() => ({
        origin: "local" as const,
        sourceId: resource.id,
      })),
    ];
    const applicable =
      this.#resolver.getApplicableResourceMiddlewares(resource);

    return applicable.map((middleware, order) => ({
      id: this.resolveMiddlewareId(middleware),
      order,
      ...annotations[order]!,
    }));
  }

  private annotateFilteredMiddleware(
    effective: ITaskMiddleware[],
    applicable: ITaskMiddleware[],
    annotations: MiddlewareAnnotation[],
  ): IRuntimeInspectionMiddleware[] {
    let applicableIndex = 0;
    return effective.map((middleware, order) => {
      while (applicable[applicableIndex] !== middleware) {
        applicableIndex += 1;
      }
      const annotation = annotations[applicableIndex]!;
      applicableIndex += 1;
      return {
        id: this.resolveMiddlewareId(middleware),
        order,
        ...annotation,
      };
    });
  }

  private resolveMiddlewareId(
    middleware: ITaskMiddleware | IResourceMiddleware,
  ): string {
    return this.#store.lookup.tryCanonicalId(middleware) ?? middleware.id;
  }

  private createSubtreeLookup() {
    return {
      getOwnerResourceId: (itemId: string) =>
        this.#store.getOwnerResourceId(itemId),
      getResource: (resourceId: string) =>
        this.#store.resources.get(resourceId)?.resource,
    };
  }
}
