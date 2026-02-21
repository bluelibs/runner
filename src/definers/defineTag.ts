import {
  ITag,
  ITagDefinition,
  ITaggable,
  TagType,
  IOptionalDependency,
  ITagConfigured,
  ITagBeforeInitDependency,
  symbolTag,
  symbolFilePath,
  symbolTagConfigured,
  symbolOptionalDependency,
  symbolTagBeforeInitDependency,
} from "../defs";
import { validationError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";

/**
 * Create a tag definition.
 * - `.with(config)` to create configured instances
 * - `.extract(tags)` to extract this tag from a list of tags or a taggable's meta
 *
 * @typeParam TConfig - Configuration type carried by configured tags.
 * @typeParam TEnforceContract - Optional helper type to enforce a contract when tags are used.
 * @param definition - The tag definition (id).
 * @returns A tag object with helpers to configure and extract.
 */
export function defineTag<
  TConfig = void,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
>(
  definition: ITagDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract
  >,
): ITag<TConfig, TEnforceInputContract, TEnforceOutputContract> {
  const id = definition.id;
  const filePath = getCallerFile();
  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const foundation = {
    id,
    meta: definition.meta ?? {},
    config: definition.config,
    configSchema: definition.configSchema,
  } as ITag<TConfig, TEnforceInputContract, TEnforceOutputContract>;

  return {
    ...foundation,
    [symbolTag]: true,
    [symbolFilePath]: filePath,
    /**
     * Specify custom config for this tag which extends the default one if exists
     * @param tagConfig
     * @returns
     */
    with(tagConfig: TConfig) {
      if (definition.configSchema) {
        try {
          tagConfig = definition.configSchema.parse(tagConfig);
        } catch (error) {
          validationError.throw({
            subject: "Tag config",
            id: this.id,
            originalError: error as Error,
          });
        }
      }
      let config: TConfig;
      if (isPlainObject(tagConfig)) {
        if (isPlainObject(foundation.config)) {
          config = {
            ...foundation.config,
            ...tagConfig,
          };
        } else {
          config = tagConfig;
        }
      } else {
        config = tagConfig;
      }
      return {
        ...this,
        [symbolTagConfigured]: true,
        config,
      } as ITagConfigured<
        TConfig,
        TEnforceInputContract,
        TEnforceOutputContract
      >;
    },
    optional() {
      return {
        inner: this,
        [symbolOptionalDependency]: true,
      } as IOptionalDependency<
        ITag<TConfig, TEnforceInputContract, TEnforceOutputContract>
      >;
    },
    beforeInit() {
      const wrapper: ITagBeforeInitDependency<
        ITag<TConfig, TEnforceInputContract, TEnforceOutputContract>
      > = {
        tag: this,
        [symbolTagBeforeInitDependency]: true,
        optional() {
          return {
            inner: wrapper,
            [symbolOptionalDependency]: true,
          } as IOptionalDependency<typeof wrapper>;
        },
      };

      return wrapper;
    },
    /**
     * Checks if the tag exists in a taggable or a list of tags.
     * @param target
     * @returns
     */
    exists(target: ITaggable | TagType[]): boolean {
      const currentTags: TagType[] = Array.isArray(target)
        ? target
        : target.tags;

      for (const candidate of currentTags) {
        if (candidate.id === id) {
          return true;
        }
      }

      return false;
    },
    /**
     * Function which serves 2 purposes, verifying if the task exists, and retrieving its config
     * @param target
     * @returns
     */
    extract(target: ITaggable | TagType[]): TConfig | undefined {
      const currentTags: TagType[] = Array.isArray(target)
        ? target
        : target.tags || [];

      for (const candidate of currentTags) {
        if (candidate.id === id) {
          return candidate.config as TConfig;
        }
      }

      return;
    },
  } satisfies ITag<TConfig, TEnforceInputContract, TEnforceOutputContract>;
}
