import type { ITagMeta, IValidationSchema } from "../../../defs";

/**
 * Internal state for the TagFluentBuilder.
 * Kept immutable and frozen.
 */
export type BuilderState<TConfig, _TEnforceIn, _TEnforceOut> = Readonly<{
  id: string;
  filePath: string;
  meta?: ITagMeta;
  configSchema?: IValidationSchema<any>;
  config?: TConfig;
}>;
