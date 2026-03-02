import type {
  ITag,
  ITagMeta,
  TagTarget,
  ValidationSchemaInput,
} from "../../../defs";

export interface TagFluentBuilder<
  TConfig = void,
  TEnforceIn = void,
  TEnforceOut = void,
  TAllowedTargets extends TagTarget | void = void,
> {
  id: string;
  meta<TNewMeta extends ITagMeta>(
    m: TNewMeta,
  ): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut, TAllowedTargets>;

  configSchema<TNewConfig>(
    schema: ValidationSchemaInput<TNewConfig>,
  ): TagFluentBuilder<TNewConfig, TEnforceIn, TEnforceOut, TAllowedTargets>;

  /**
   * Alias for configSchema. Use this to define the tag configuration validation contract.
   */
  schema<TNewConfig>(
    schema: ValidationSchemaInput<TNewConfig>,
  ): TagFluentBuilder<TNewConfig, TEnforceIn, TEnforceOut, TAllowedTargets>;

  config<TNewConfig>(
    config: TNewConfig,
  ): TagFluentBuilder<TNewConfig, TEnforceIn, TEnforceOut, TAllowedTargets>;

  for<TNewTarget extends TagTarget>(
    target: TNewTarget,
  ): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut, TNewTarget>;
  for<const TNewTargets extends readonly [TagTarget, ...TagTarget[]]>(
    targets: TNewTargets,
  ): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut, TNewTargets[number]>;
  build(): ITag<TConfig, TEnforceIn, TEnforceOut, TAllowedTargets>;
}
