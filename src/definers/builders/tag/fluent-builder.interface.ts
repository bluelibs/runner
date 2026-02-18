import type { ITag, ITagMeta, IValidationSchema } from "../../../defs";

export interface TagFluentBuilder<
  TConfig = void,
  TEnforceIn = void,
  TEnforceOut = void,
> {
  id: string;
  meta<TNewMeta extends ITagMeta>(
    m: TNewMeta,
  ): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut>;

  configSchema<TNewConfig>(
    schema: IValidationSchema<TNewConfig>,
  ): TagFluentBuilder<TNewConfig, TEnforceIn, TEnforceOut>;

  /**
   * Alias for configSchema. Use this to define the tag configuration validation contract.
   */
  schema<TNewConfig>(
    schema: IValidationSchema<TNewConfig>,
  ): TagFluentBuilder<TNewConfig, TEnforceIn, TEnforceOut>;

  config<TNewConfig>(
    config: TNewConfig,
  ): TagFluentBuilder<TNewConfig, TEnforceIn, TEnforceOut>;
  build(): ITag<TConfig, TEnforceIn, TEnforceOut>;
}
