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
} from "./utilities";

export interface ITaggable {
  tags: TagType[];
}

export type TagTarget =
  | "tasks"
  | "resources"
  | "events"
  | "hooks"
  | "taskMiddlewares"
  | "resourceMiddlewares"
  | "errors";

export interface ITagDefinition<
  TConfig = void,
  _TEnforceInputContract = void,
  _TEnforceOutputContract = void,
  _TAllowedTargets extends TagTarget | void = void,
> {
  id: string;
  meta?: ITagMeta;
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
   * A special validation property.
   * It resolves to `true` if TConfig only has optional keys, otherwise `false`.
   */
  readonly __configHasOnlyOptionalKeys: RequiredKeys<TConfig> extends never
    ? true
    : false;
  /**
   * Type-only phantom used to filter tags by allowed target in builder APIs.
   * Optional so it has zero runtime requirements.
   */
  readonly __allowedTagTargets?: TAllowedTargets;

  config?: TConfig;
  configSchema?: IValidationSchema<TConfig>;
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
  config: TConfig;
}

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
