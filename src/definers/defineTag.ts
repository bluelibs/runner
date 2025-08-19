import {
  ITag,
  ITagDefinition,
  ITaggable,
  TagType,
  ITagConfigured,
  symbolTag,
  symbolFilePath,
  symbolTagConfigured,
} from "../defs";
import { ValidationError } from "../errors";
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
  const foundation = {
    id,
    meta: definition.meta,
    config: definition.config,
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
          throw new ValidationError("Tag config", this.id, error as Error);
        }
      }
      let config: TConfig;
      if (typeof tagConfig === "object") {
        if (typeof foundation.config === "object") {
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
        ...foundation,
        [symbolTagConfigured]: true,
        config,
      } as ITagConfigured<
        TConfig,
        TEnforceInputContract,
        TEnforceOutputContract
      >;
    },
    /**
     * Checks if the tag exists in a taggable or a list of tags.
     * @param target
     * @returns
     */
    exists(target: ITaggable | TagType[]): boolean {
      let currentTags: TagType[] = [];
      if (Array.isArray(target)) {
        currentTags = target;
      } else {
        currentTags = target.tags || [];
      }

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
      let currentTags: TagType[] = [];
      if (Array.isArray(target)) {
        currentTags = target;
      } else {
        currentTags = target.tags || [];
      }

      for (const candidate of currentTags) {
        if (candidate.id === id) {
          return candidate.config as TConfig;
        }
      }

      return;
    },
  } satisfies ITag<TConfig, TEnforceInputContract, TEnforceOutputContract>;
}
