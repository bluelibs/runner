import type {
  DependencyMapType,
  IResourceDefinition,
  IResourceMeta,
  IsolationPolicyDeclaration,
  OverridableElements,
  RegisterableItem,
  ResourceInitFn,
  ResourceMiddlewareAttachmentType,
  ResourceSubtreePolicyDeclaration,
  ResourceTagType,
  ValidationSchemaInput,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import type { RunnerMode } from "../../../types/runner";

/**
 * Internal builder state - immutable snapshot of all builder configuration.
 */
export type BuilderState<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
> = Readonly<{
  id: string;
  filePath: string;
  dependencies?: TDeps | ((config: TConfig, mode: RunnerMode) => TDeps);
  register?:
    | Array<RegisterableItem>
    | ((config: TConfig, mode: RunnerMode) => Array<RegisterableItem>);
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
  ready?: NonNullable<
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
    >["ready"]
  >;
  cooldown?: NonNullable<
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
    >["cooldown"]
  >;
  health?: NonNullable<
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
    >["health"]
  >;
  configSchema?: ValidationSchemaInput<any>;
  resultSchema?: ValidationSchemaInput<any>;
  meta?: TMeta;
  overrides?:
    | Array<OverridableElements>
    | ((config: TConfig, mode: RunnerMode) => Array<OverridableElements>);
  throws?: ThrowsList;
  isolateDeclarations?: ReadonlyArray<IsolationPolicyDeclaration<TConfig>>;
  subtreeDeclarations?: ReadonlyArray<
    ResourceSubtreePolicyDeclaration<TConfig>
  >;
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
  | RegisterableItem
  | Array<RegisterableItem>
  | ((
      config: TConfig,
      mode: RunnerMode,
    ) => RegisterableItem | Array<RegisterableItem>);

/**
 * Internal state representation for register.
 */
export type RegisterState<TConfig> =
  | Array<RegisterableItem>
  | ((config: TConfig, mode: RunnerMode) => Array<RegisterableItem>)
  | undefined;

export type OverridesInput<TConfig> =
  | Array<OverridableElements>
  | ((config: TConfig, mode: RunnerMode) => Array<OverridableElements>);

export type OverridesState<TConfig> =
  | Array<OverridableElements>
  | ((config: TConfig, mode: RunnerMode) => Array<OverridableElements>)
  | undefined;
