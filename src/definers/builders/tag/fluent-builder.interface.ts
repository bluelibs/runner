import type {
  ResolveValidationSchemaInput,
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
  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends ITagMeta>(
    m: TNewMeta,
  ): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut, TAllowedTargets>;

  /** Declares the tag configuration schema. */
  configSchema<
    TNewConfig = never,
    TSchema extends ValidationSchemaInput<
      [TNewConfig] extends [never] ? any : TNewConfig
    > = ValidationSchemaInput<[TNewConfig] extends [never] ? any : TNewConfig>,
  >(
    schema: TSchema,
  ): TagFluentBuilder<
    ResolveValidationSchemaInput<TNewConfig, TSchema>,
    TEnforceIn,
    TEnforceOut,
    TAllowedTargets
  >;

  /**
   * Alias for configSchema. Use this to define the tag configuration validation contract.
   */
  schema<
    TNewConfig = never,
    TSchema extends ValidationSchemaInput<
      [TNewConfig] extends [never] ? any : TNewConfig
    > = ValidationSchemaInput<[TNewConfig] extends [never] ? any : TNewConfig>,
  >(
    schema: TSchema,
  ): TagFluentBuilder<
    ResolveValidationSchemaInput<TNewConfig, TSchema>,
    TEnforceIn,
    TEnforceOut,
    TAllowedTargets
  >;

  /** Stores default configuration on the tag definition. */
  config<TNewConfig>(
    config: TNewConfig,
  ): TagFluentBuilder<TNewConfig, TEnforceIn, TEnforceOut, TAllowedTargets>;

  /** Restricts the tag to a single definition kind. */
  for<TNewTarget extends TagTarget>(
    target: TNewTarget,
  ): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut, TNewTarget>;
  /** Restricts the tag to multiple definition kinds. */
  for<const TNewTargets extends readonly [TagTarget, ...TagTarget[]]>(
    targets: TNewTargets,
  ): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut, TNewTargets[number]>;
  /** Materializes the final tag definition for registration or reuse. */
  build(): ITag<TConfig, TEnforceIn, TEnforceOut, TAllowedTargets>;
}
