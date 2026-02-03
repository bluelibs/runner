import { IContractable } from "./contracts";
import { ITagMeta } from "./meta";
import {
  IValidationSchema,
  RequiredKeys,
  symbolFilePath,
  symbolTag,
  symbolTagConfigured,
} from "./utilities";

export interface ITaggable {
  tags: TagType[];
}

export interface ITagDefinition<
  TConfig = void,
  _TEnforceInputContract = void,
  _TEnforceOutputContract = void,
> {
  id: string;
  meta?: ITagMeta;
  configSchema?: IValidationSchema<TConfig>;
  /**
   * Utilizing config at definition level stores its defaults
   */
  config?: TConfig;
}

export interface ITag<
  TConfig = void,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
>
  extends
    ITagDefinition<TConfig, TEnforceInputContract, TEnforceOutputContract>,
    IContractable<TConfig, TEnforceInputContract, TEnforceOutputContract> {
  /**
   * A special validation property.
   * It resolves to `true` if TConfig only has optional keys, otherwise `false`.
   */
  readonly __configHasOnlyOptionalKeys: RequiredKeys<TConfig> extends never
    ? true
    : false;

  config?: TConfig;
  /**
   * Checks if the tag exists in a taggable or a list of tags.
   */
  exists(target: ITaggable | TagType[]): boolean;
  /**
   * Creates a configured instance of the tag.
   */
  with(
    config: TConfig,
  ): ITagConfigured<TConfig, TEnforceInputContract, TEnforceOutputContract>;
  /**
   * Extracts the configuration of the tag from a taggable or a list of tags.
   */
  extract(target: ITaggable | TagType[]): TConfig | undefined;
  [symbolFilePath]: string;
  [symbolTag]: true;
}

type ITagWithOptionalConfig<
  _TValue,
  TEnforceInputContract,
  TEnforceOutputContract,
> = ITag<any, TEnforceInputContract, TEnforceOutputContract> & {
  readonly __configHasOnlyOptionalKeys: true;
};

export interface ITagConfigured<
  TConfig = void,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
> extends ITag<TConfig, TEnforceInputContract, TEnforceOutputContract> {
  [symbolTagConfigured]: true;
  config: TConfig;
}

export type TagType =
  | ITag<void, any, any>
  | ITagWithOptionalConfig<any, any, any>
  | ITagConfigured<any, any, any>;
