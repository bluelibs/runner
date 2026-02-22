import type { ITagMeta, IValidationSchema, TagTarget } from "../../../defs";

/**
 * Internal state for the TagFluentBuilder.
 * Kept immutable and frozen.
 */
export type BuilderState<
  TConfig,
  _TEnforceIn,
  _TEnforceOut,
  _TAllowedTargets extends TagTarget | void = void,
> = Readonly<{
  id: string;
  filePath: string;
  meta?: ITagMeta;
  configSchema?: IValidationSchema<any>;
  config?: TConfig;
  targets?: readonly TagTarget[];
}>;
