import { IContractable } from "./contracts";
import { ITagMeta } from "./meta";
import {
  ITagStartupDependency,
  IOptionalDependency,
  IValidationSchema,
  ValidationSchemaInput,
  RequiredKeys,
  symbolFilePath,
  symbolTag,
  symbolTagConfigured,
  symbolTagConfiguredFrom,
} from "./utilities";

/**
 * Minimal shape for definitions that carry tags.
 */
export interface ITaggable {
  tags: TagType[];
}

/**
 * Definition kinds a tag may legally attach to.
 */
export type TagTarget =
  | "tasks"
  | "resources"
  | "events"
  | "hooks"
  | "taskMiddlewares"
  | "resourceMiddlewares"
  | "errors";

/**
 * Declarative tag definition contract.
 */
export interface ITagDefinition<
  TConfig = void,
  _TEnforceInputContract = void,
  _TEnforceOutputContract = void,
  _TAllowedTargets extends TagTarget | void = void,
> {
  /** Stable tag identifier. */
  id: string;
  /** Optional metadata used by docs and tooling. */
  meta?: ITagMeta;
  /** Optional validation schema for configured tag payloads. */
  configSchema?: ValidationSchemaInput<TConfig>;
  /**
   * Utilizing config at definition level stores its defaults
   */
  config?: TConfig;
  /**
   * Restricts where this tag can be attached. Omit to allow any taggable
   * definition kind.
   */
  targets?: readonly TagTarget[];
}

/**
 * Normalized runtime tag definition.
 *
 * Tags carry discovery metadata and may also encode input/output contracts.
 */
export interface ITag<
  TConfig = void,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TAllowedTargets extends TagTarget | void = void,
>
  extends
    ITagDefinition<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TAllowedTargets
    >,
    IContractable<TConfig, TEnforceInputContract, TEnforceOutputContract> {
  /**
   * Type-level helper used by builder overloads when tag config is fully optional.
   */
  readonly __configHasOnlyOptionalKeys: RequiredKeys<TConfig> extends never
    ? true
    : false;
  /**
   * Type-level helper used to constrain tag usage to allowed definition kinds.
   */
  readonly __allowedTagTargets?: TAllowedTargets;

  /** Default configuration stored on the tag definition itself. */
  config?: TConfig;
  /** Normalized validation schema for configured tag payloads. */
  configSchema?: IValidationSchema<TConfig>;
  /** Normalized metadata attached to this tag. */
  meta: ITagMeta;
  /**
   * Checks if the tag exists in a taggable or a list of tags.
   */
  exists(target: ITaggable | TagType[]): boolean;
  /**
   * Creates a configured instance of the tag.
   */
  with(
    config: TConfig,
  ): ITagConfigured<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TAllowedTargets
  >;
  /**
   * Extracts the configuration of the tag from a taggable or a list of tags.
   */
  extract(target: ITaggable | TagType[]): TConfig | undefined;
  /** Return an optional dependency wrapper for this tag. */
  optional: () => IOptionalDependency<
    ITag<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TAllowedTargets
    >
  >;
  /** Return a startup dependency wrapper for this tag. */
  startup: () => ITagStartupDependency<
    ITag<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TAllowedTargets
    >
  >;
  [symbolFilePath]: string;
  [symbolTag]: true;
}

/**
 * Helper alias for tags whose config is entirely optional.
 */
export type ITagWithOptionalConfig<
  _TValue,
  TEnforceInputContract,
  TEnforceOutputContract,
  TAllowedTargets extends TagTarget | void = void,
> = ITag<
  any,
  TEnforceInputContract,
  TEnforceOutputContract,
  TAllowedTargets
> & {
  readonly __configHasOnlyOptionalKeys: true;
};

/**
 * Configured tag instance returned by `tag.with(...)`.
 */
export interface ITagConfigured<
  TConfig = void,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TAllowedTargets extends TagTarget | void = void,
> extends ITag<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TAllowedTargets
> {
  [symbolTagConfigured]: true;
  [symbolTagConfiguredFrom]?: ITag<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TAllowedTargets
  >;
  config: TConfig;
}

/**
 * Any tag value that can appear in a `tags: [...]` array.
 */
export type TagType =
  | ITag<void, any, any, any>
  | ITagWithOptionalConfig<any, any, any, any>
  | ITagConfigured<any, any, any, any>;

type FilterTagByTarget<
  TCandidate,
  TTarget extends TagTarget,
> = TCandidate extends { readonly __allowedTagTargets?: infer TAllowedTargets }
  ? [TAllowedTargets] extends [void]
    ? TCandidate
    : TTarget extends TAllowedTargets
      ? TCandidate
      : never
  : never;

export type TagTypeFor<TTarget extends TagTarget> = FilterTagByTarget<
  TagType,
  TTarget
>;

/**
 * Compile-time guard ensuring a tag list is valid for a specific definition kind.
 */
export type EnsureTagsForTarget<
  TTarget extends TagTarget,
  TTags extends readonly TagType[],
> = TTags & {
  readonly [K in Exclude<keyof TTags, keyof any[]>]: FilterTagByTarget<
    TTags[K],
    TTarget
  >;
};

export type TaskTagType = TagTypeFor<"tasks">;
export type ResourceTagType = TagTypeFor<"resources">;
export type EventTagType = TagTypeFor<"events">;
export type HookTagType = TagTypeFor<"hooks">;
export type TaskMiddlewareTagType = TagTypeFor<"taskMiddlewares">;
export type ResourceMiddlewareTagType = TagTypeFor<"resourceMiddlewares">;
export type ErrorTagType = TagTypeFor<"errors">;
