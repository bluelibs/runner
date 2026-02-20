import type {
  DependencyMapType,
  IResourceDefinition,
  IResourceMeta,
  IValidationSchema,
  RegisterableItems,
  ResourceInitFn,
  ResourceMiddlewareAttachmentType,
  TagType,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

/**
 * Internal builder state - immutable snapshot of all builder configuration.
 */
export type BuilderState<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
> = Readonly<{
  id: string;
  filePath: string;
  dependencies?: TDeps | ((config: TConfig) => TDeps);
  register?:
    | Array<RegisterableItems>
    | ((config: TConfig) => Array<RegisterableItems>);
  middleware?: TMiddleware;
  tags?: TTags;
  context?: () => TContext;
  init?: ResourceInitFn<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  dispose?: NonNullable<
    IResourceDefinition<
      TConfig,
      TValue,
      TDeps,
      TContext,
      any,
      any,
      TMeta,
      TTags,
      TMiddleware
    >["dispose"]
  >;
  configSchema?: IValidationSchema<any>;
  resultSchema?: IValidationSchema<any>;
  meta?: TMeta;
  overrides?: Array<any>;
  throws?: ThrowsList;
  exports?: Array<RegisterableItems>;
}>;

/**
 * Helper type to determine if config should be replaced.
 */
export type ShouldReplaceConfig<T> = [T] extends [void]
  ? true
  : [T] extends [undefined]
    ? true
    : false;

/**
 * Resolves the config type - uses proposed if existing is void/undefined.
 */
export type ResolveConfig<TExisting, TProposed> =
  ShouldReplaceConfig<TExisting> extends true ? TProposed : TExisting;

/**
 * Input types accepted by the register() method.
 */
export type RegisterInput<TConfig> =
  | RegisterableItems
  | Array<RegisterableItems>
  | ((config: TConfig) => RegisterableItems | Array<RegisterableItems>);

/**
 * Internal state representation for register.
 */
export type RegisterState<TConfig> =
  | Array<RegisterableItems>
  | ((config: TConfig) => Array<RegisterableItems>)
  | undefined;
