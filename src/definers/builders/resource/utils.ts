import type {
  DependencyMapType,
  IResourceMeta,
  OverridableElements,
  RegisterableItems,
  ResourceMiddlewareAttachmentType,
  ResourceTagType,
} from "../../../defs";
import type { RunnerMode } from "../../../types/runner";
import type {
  BuilderState,
  OverridesInput,
  OverridesState,
  RegisterInput,
  RegisterState,
} from "./types";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
  TNextConfig = TConfig,
  TNextValue extends Promise<any> = TValue,
  TNextDeps extends DependencyMapType = TDeps,
  TNextContext = TContext,
  TNextMeta extends IResourceMeta = TMeta,
  TNextTags extends ResourceTagType[] = TTags,
  TNextMiddleware extends ResourceMiddlewareAttachmentType[] = TMiddleware,
>(
  s: BuilderState<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>,
  patch: Partial<
    BuilderState<
      TNextConfig,
      TNextValue,
      TNextDeps,
      TNextContext,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >
  >,
): BuilderState<
  TNextConfig,
  TNextValue,
  TNextDeps,
  TNextContext,
  TNextMeta,
  TNextTags,
  TNextMiddleware
> {
  return Object.freeze({
    // We reuse the frozen state while widening generics, hence the temporary cast.
    ...(s as BuilderState<
      TNextConfig,
      TNextValue,
      TNextDeps,
      TNextContext,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >),
    ...patch,
  }) as BuilderState<
    TNextConfig,
    TNextValue,
    TNextDeps,
    TNextContext,
    TNextMeta,
    TNextTags,
    TNextMiddleware
  >;
}

/**
 * Normalizes register items to an array.
 */
export function toRegisterArray(
  items: RegisterableItems | Array<RegisterableItems>,
) {
  return Array.isArray(items) ? [...items] : [items];
}

/**
 * Wraps a register function to always return an array.
 */
export function normalizeRegisterFunction<TConfig>(
  fn: (
    config: TConfig,
    mode: RunnerMode,
  ) => RegisterableItems | Array<RegisterableItems>,
) {
  return (config: TConfig, mode: RunnerMode) =>
    toRegisterArray(fn(config, mode));
}

/**
 * Merges register state handling all combinations of arrays and functions.
 */
export function mergeRegister<TConfig>(
  existing: RegisterState<TConfig>,
  addition: RegisterInput<TConfig>,
  override: boolean,
): RegisterState<TConfig> {
  const isFunctionAddition = typeof addition === "function";
  const normalizedAddition = isFunctionAddition
    ? normalizeRegisterFunction(
        addition as (
          config: TConfig,
          mode: RunnerMode,
        ) => RegisterableItems | Array<RegisterableItems>,
      )
    : toRegisterArray(addition as RegisterableItems | Array<RegisterableItems>);

  if (override || !existing) {
    return isFunctionAddition
      ? (normalizedAddition as (
          config: TConfig,
          mode: RunnerMode,
        ) => Array<RegisterableItems>)
      : (normalizedAddition as Array<RegisterableItems>);
  }

  if (typeof existing === "function") {
    if (isFunctionAddition) {
      const additionFn = normalizedAddition as (
        config: TConfig,
        mode: RunnerMode,
      ) => Array<RegisterableItems>;
      return (config: TConfig, mode: RunnerMode) => [
        ...existing(config, mode),
        ...additionFn(config, mode),
      ];
    }
    const additionArray = normalizedAddition as Array<RegisterableItems>;
    return (config: TConfig, mode: RunnerMode) => [
      ...existing(config, mode),
      ...additionArray,
    ];
  }

  const existingArray = existing as Array<RegisterableItems>;
  if (isFunctionAddition) {
    const additionFn = normalizedAddition as (
      config: TConfig,
      mode: RunnerMode,
    ) => Array<RegisterableItems>;
    return (config: TConfig, mode: RunnerMode) => [
      ...existingArray,
      ...additionFn(config, mode),
    ];
  }

  return [
    ...existingArray,
    ...(normalizedAddition as Array<RegisterableItems>),
  ];
}

function normalizeOverridesFunction<TConfig>(
  fn: (config: TConfig, mode: RunnerMode) => Array<OverridableElements>,
) {
  return (config: TConfig, mode: RunnerMode) => [...fn(config, mode)];
}

export function mergeOverrides<TConfig>(
  existing: OverridesState<TConfig>,
  addition: OverridesInput<TConfig>,
  override: boolean,
): OverridesState<TConfig> {
  const isFunctionAddition = typeof addition === "function";
  const normalizedAddition = isFunctionAddition
    ? normalizeOverridesFunction(
        addition as (
          config: TConfig,
          mode: RunnerMode,
        ) => Array<OverridableElements>,
      )
    : [...addition];

  if (override || !existing) {
    return isFunctionAddition
      ? (normalizedAddition as (
          config: TConfig,
          mode: RunnerMode,
        ) => Array<OverridableElements>)
      : (normalizedAddition as Array<OverridableElements>);
  }

  if (typeof existing === "function") {
    if (isFunctionAddition) {
      const additionFn = normalizedAddition as (
        config: TConfig,
        mode: RunnerMode,
      ) => Array<OverridableElements>;
      return (config: TConfig, mode: RunnerMode) => [
        ...existing(config, mode),
        ...additionFn(config, mode),
      ];
    }
    const additionArray = normalizedAddition as Array<OverridableElements>;
    return (config: TConfig, mode: RunnerMode) => [
      ...existing(config, mode),
      ...additionArray,
    ];
  }

  const existingArray = existing as Array<OverridableElements>;
  if (isFunctionAddition) {
    const additionFn = normalizedAddition as (
      config: TConfig,
      mode: RunnerMode,
    ) => Array<OverridableElements>;
    return (config: TConfig, mode: RunnerMode) => [
      ...existingArray,
      ...additionFn(config, mode),
    ];
  }

  return [
    ...existingArray,
    ...(normalizedAddition as Array<OverridableElements>),
  ];
}

export { mergeArray } from "../shared/mergeUtils";
export { mergeDepsWithConfig as mergeDependencies } from "../shared/mergeUtils";
