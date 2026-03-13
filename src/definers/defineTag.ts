import {
  symbolDefinitionIdentity,
  ITag,
  ITagDefinition,
  ITaggable,
  TagType,
  IOptionalDependency,
  ITagConfigured,
  ITagStartupDependency,
  TagTarget,
  symbolTag,
  symbolFilePath,
  symbolTagConfigured,
  symbolTagConfiguredFrom,
  symbolOptionalDependency,
  symbolTagBeforeInitDependency,
} from "../defs";
import type {
  InferValidationSchemaInput,
  ValidationSchemaInput,
} from "../types/utilities";
import { validationError } from "../errors";
import { isMatchError } from "../tools/check/errors";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze, freezeIfLineageLocked } from "../tools/deepFreeze";
import { isSameDefinition } from "../tools/isSameDefinition";
import { assertDefinitionId } from "./assertDefinitionId";
import { normalizeOptionalValidationSchema } from "./normalizeValidationSchema";

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
  TSchema extends ValidationSchemaInput<any>,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TAllowedTargets extends TagTarget | void = void,
>(
  definition: Omit<
    ITagDefinition<
      InferValidationSchemaInput<TSchema>,
      TEnforceInputContract,
      TEnforceOutputContract,
      TAllowedTargets
    >,
    "configSchema"
  > & {
    configSchema: TSchema;
  },
): ITag<
  InferValidationSchemaInput<TSchema>,
  TEnforceInputContract,
  TEnforceOutputContract,
  TAllowedTargets
>;
export function defineTag<
  TConfig = void,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TAllowedTargets extends TagTarget | void = void,
>(
  definition: ITagDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TAllowedTargets
  >,
): ITag<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TAllowedTargets
>;
export function defineTag<
  TConfig = void,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TAllowedTargets extends TagTarget | void = void,
>(
  definition: ITagDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TAllowedTargets
  >,
): ITag<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TAllowedTargets
> {
  const filePath = getCallerFile();
  const id = definition.id;
  assertDefinitionId("Tag", id);
  const configSchema = normalizeOptionalValidationSchema(
    definition.configSchema,
    {
      definitionId: id,
      subject: "Tag config",
    },
  );
  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const definitionIdentity = {};
  const foundation = {
    id,
    meta: definition.meta ?? {},
    config: definition.config,
    configSchema,
    targets: definition.targets,
    [symbolDefinitionIdentity]: definitionIdentity,
  } as unknown as ITag<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TAllowedTargets
  >;

  return deepFreeze({
    ...foundation,
    [symbolTag]: true,
    [symbolFilePath]: filePath,
    /**
     * Specify custom config for this tag which extends the default one if exists
     * @param tagConfig
     * @returns
     */
    with(tagConfig: TConfig) {
      if (configSchema) {
        try {
          tagConfig = configSchema.parse(tagConfig);
        } catch (error) {
          if (isMatchError(error)) {
            throw error;
          }
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
      const configuredFrom =
        (this as unknown as Record<symbol, unknown>)[symbolTagConfiguredFrom] ??
        this;
      const configured = {
        ...this,
        [symbolTagConfigured]: true,
        config,
      } as ITagConfigured<
        TConfig,
        TEnforceInputContract,
        TEnforceOutputContract,
        TAllowedTargets
      >;
      (configured as unknown as Record<symbol, unknown>)[
        symbolTagConfiguredFrom
      ] = configuredFrom;
      return freezeIfLineageLocked(this, configured);
    },
    optional() {
      const wrapper = {
        inner: this,
        [symbolOptionalDependency]: true,
      } as IOptionalDependency<
        ITag<
          TConfig,
          TEnforceInputContract,
          TEnforceOutputContract,
          TAllowedTargets
        >
      >;
      return freezeIfLineageLocked(this, wrapper);
    },
    startup() {
      const wrapper: ITagStartupDependency<
        ITag<
          TConfig,
          TEnforceInputContract,
          TEnforceOutputContract,
          TAllowedTargets
        >
      > = {
        tag: this,
        [symbolTagBeforeInitDependency]: true,
        optional() {
          const optionalWrapper = {
            inner: wrapper,
            [symbolOptionalDependency]: true,
          } as IOptionalDependency<typeof wrapper>;
          return freezeIfLineageLocked(wrapper, optionalWrapper);
        },
      };

      return freezeIfLineageLocked(this, wrapper);
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
        if (isSameDefinition(candidate, this)) {
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
        if (isSameDefinition(candidate, this)) {
          return candidate.config as TConfig;
        }
      }

      return;
    },
  } satisfies ITag<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TAllowedTargets
  >);
}
