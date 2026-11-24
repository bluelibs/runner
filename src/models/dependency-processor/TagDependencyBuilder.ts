import {
  ExtractTaskInput,
  ExtractTaskOutput,
  ITag,
  ITask,
  TagDependencyAccessor,
  TaggedTask,
  TaskCallOptions,
  TaskDependency,
} from "../../defs";
import { dependencyNotFoundError } from "../../errors";
import type { Store } from "../store/Store";
import type { ResourceDependencyWrapper } from "./ResourceDependencyWrapper";

/**
 * Builds lazy, visibility-scoped tag dependency accessors with cached task runners
 * and live resource value getters.
 */
export class TagDependencyBuilder {
  constructor(
    private readonly store: Store,
    private readonly resolveDefinitionId: (value: unknown) => string,
    private readonly extractTaskDependency: (
      object: ITask<any, any, {}>,
      source?: string,
    ) => Promise<any>,
    private readonly resourceDependencyWrapper: ResourceDependencyWrapper,
  ) {}

  async extractTagDependency<TTag extends ITag<any, any, any>>(
    tag: TTag,
    source: string,
  ): Promise<TagDependencyAccessor<TTag>> {
    const tagId = this.resolveDefinitionId(tag);
    if (!this.store.tags.has(tagId)) {
      dependencyNotFoundError.throw({ key: `Tag ${tagId}` });
    }

    const effectiveTag = this.store.tags.get(tagId)! as TTag;
    const baseAccessor = this.store.getTagAccessor(effectiveTag, {
      consumerId: source,
      includeSelf: false,
    });
    const ownerResourceId = this.store.resources.has(source)
      ? source
      : undefined;

    let tasksCache: TagDependencyAccessor<TTag>["tasks"] | undefined;
    let resourcesCache: TagDependencyAccessor<TTag>["resources"] | undefined;

    const readTasks = (): TagDependencyAccessor<TTag>["tasks"] => {
      if (!tasksCache) {
        tasksCache = Object.freeze(
          baseAccessor.tasks.map((entry) => ({
            definition: entry.definition,
            config: entry.config,
            run: this.createTaggedTaskRunner(entry.definition, source),
            ...(ownerResourceId
              ? this.createTaggedTaskInterceptHelpers(
                  entry.definition,
                  ownerResourceId,
                )
              : {}),
          })),
        );
      }
      return tasksCache;
    };

    const readResources = (): TagDependencyAccessor<TTag>["resources"] => {
      if (!resourcesCache) {
        resourcesCache = Object.freeze(
          baseAccessor.resources.map((entry) =>
            this.createRuntimeTaggedResourceMatch(entry),
          ),
        );
      }
      return resourcesCache;
    };

    const accessor: TagDependencyAccessor<TTag> = {
      get tasks() {
        return readTasks();
      },
      get resources() {
        return readResources();
      },
      get events() {
        return baseAccessor.events;
      },
      get hooks() {
        return baseAccessor.hooks;
      },
      get taskMiddlewares() {
        return baseAccessor.taskMiddlewares;
      },
      get resourceMiddlewares() {
        return baseAccessor.resourceMiddlewares;
      },
      get errors() {
        return baseAccessor.errors;
      },
    };

    return Object.freeze(accessor);
  }

  private createTaggedTaskRunner<TTask extends TaggedTask<any>>(
    task: TTask,
    source: string,
  ): TaskDependency<ExtractTaskInput<TTask>, ExtractTaskOutput<TTask>> {
    let cachedRunner:
      | ((
          input: ExtractTaskInput<TTask>,
          options?: TaskCallOptions,
        ) => ExtractTaskOutput<TTask>)
      | undefined;

    const ensureRunner = async () => {
      if (!cachedRunner) {
        cachedRunner = (await this.extractTaskDependency(
          task as ITask<any, any, {}>,
          source,
        )) as (
          input: ExtractTaskInput<TTask>,
          options?: TaskCallOptions,
        ) => ExtractTaskOutput<TTask>;
      }
      return cachedRunner;
    };

    return (async (
      input?: ExtractTaskInput<TTask>,
      options?: TaskCallOptions,
    ) => {
      const runner = await ensureRunner();
      return runner(input as ExtractTaskInput<TTask>, options);
    }) as TaskDependency<ExtractTaskInput<TTask>, ExtractTaskOutput<TTask>>;
  }

  private createTaggedTaskInterceptHelpers<TTask extends TaggedTask<any>>(
    task: TTask,
    ownerResourceId: string,
  ): Pick<
    TagDependencyAccessor<ITag<any, any, any>>["tasks"][number],
    "intercept" | "getInterceptingResourceIds"
  > {
    const withIntercept = this.resourceDependencyWrapper.makeTaskWithIntercept(
      task as unknown as ITask<any, any, any>,
      ownerResourceId,
    );

    return {
      intercept: withIntercept.intercept,
      getInterceptingResourceIds: withIntercept.getInterceptingResourceIds,
    };
  }

  createRuntimeTaggedResourceMatch<TTag extends ITag<any, any, any>>(
    entry: TagDependencyAccessor<TTag>["resources"][number],
  ): TagDependencyAccessor<TTag>["resources"][number] {
    const resourceId = entry.definition.id;
    const store = this.store;
    return {
      definition: entry.definition,
      config: entry.config,
      get value() {
        const storeResource = store.resources.get(resourceId);
        if (!storeResource || !storeResource.isInitialized) {
          return undefined;
        }

        return storeResource.value as TagDependencyAccessor<TTag>["resources"][number]["value"];
      },
    };
  }
}
