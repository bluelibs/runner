import type {
  DependencyMapType,
  IResourceMeta,
  RegisterableItems,
  ResourceMiddlewareAttachmentType,
  TagType,
} from "../../../defs";
import type { BuilderState, RegisterInput, RegisterState } from "./types";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
  TNextConfig = TConfig,
  TNextValue extends Promise<any> = TValue,
  TNextDeps extends DependencyMapType = TDeps,
  TNextContext = TContext,
  TNextMeta extends IResourceMeta = TMeta,
  TNextTags extends TagType[] = TTags,
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
    ...(s as unknown as BuilderState<
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
  fn: (config: TConfig) => RegisterableItems | Array<RegisterableItems>,
) {
  return (config: TConfig) => toRegisterArray(fn(config));
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
        ) => RegisterableItems | Array<RegisterableItems>,
      )
    : toRegisterArray(addition as RegisterableItems | Array<RegisterableItems>);

  if (override || !existing) {
    return isFunctionAddition
      ? (normalizedAddition as (config: TConfig) => Array<RegisterableItems>)
      : (normalizedAddition as Array<RegisterableItems>);
  }

  if (typeof existing === "function") {
    if (isFunctionAddition) {
      const additionFn = normalizedAddition as (
        config: TConfig,
      ) => Array<RegisterableItems>;
      return (config: TConfig) => [...existing(config), ...additionFn(config)];
    }
    const additionArray = normalizedAddition as Array<RegisterableItems>;
    return (config: TConfig) => [...existing(config), ...additionArray];
  }

  const existingArray = existing as Array<RegisterableItems>;
  if (isFunctionAddition) {
    const additionFn = normalizedAddition as (
      config: TConfig,
    ) => Array<RegisterableItems>;
    return (config: TConfig) => [...existingArray, ...additionFn(config)];
  }

  return [
    ...existingArray,
    ...(normalizedAddition as Array<RegisterableItems>),
  ];
}

/**
 * Generic array merge with override support.
 */
export function mergeArray<T>(
  existing: ReadonlyArray<T> | undefined,
  addition: ReadonlyArray<T>,
  override: boolean,
): T[] {
  const toArray = [...addition];
  if (override || !existing) {
    return toArray as T[];
  }
  return [...existing, ...toArray] as T[];
}

/**
 * Merges dependencies handling all combinations of objects and functions.
 */
export function mergeDependencies<
  TConfig,
  TExisting extends DependencyMapType,
  TNew extends DependencyMapType,
>(
  existing: TExisting | ((config: TConfig) => TExisting) | undefined,
  addition: TNew | ((config: TConfig) => TNew),
  override: boolean,
): (TExisting & TNew) | ((config: TConfig) => TExisting & TNew) {
  const isFnExisting = typeof existing === "function";
  const isFnAddition = typeof addition === "function";

  if (override || !existing) {
    return addition as any as
      | (TExisting & TNew)
      | ((config: TConfig) => TExisting & TNew);
  }

  if (isFnExisting && isFnAddition) {
    const e = existing as (config: TConfig) => TExisting;
    const a = addition as (config: TConfig) => TNew;
    return ((config: TConfig) => ({
      ...(e(config) as any),
      ...(a(config) as any),
    })) as any;
  }
  if (isFnExisting && !isFnAddition) {
    const e = existing as (config: TConfig) => TExisting;
    const a = addition as TNew;
    return ((config: TConfig) => ({
      ...(e(config) as any),
      ...(a as any),
    })) as any;
  }
  if (!isFnExisting && isFnAddition) {
    const e = existing as TExisting;
    const a = addition as (config: TConfig) => TNew;
    return ((config: TConfig) => ({
      ...(e as any),
      ...(a(config) as any),
    })) as any;
  }
  const e = existing as TExisting;
  const a = addition as TNew;
  return { ...(e as any), ...(a as any) } as any;
}
