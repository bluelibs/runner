import type { DependencyMapType } from "../../../defs";

/**
 * Shared builder utility: merges arrays with override support.
 * When `override` is true, returns only the addition; otherwise concatenates.
 */
export function mergeArray<T>(
  existing: ReadonlyArray<T> | undefined,
  addition: ReadonlyArray<T>,
  override: boolean,
): T[] {
  const toArray = [...addition];
  if (override || !existing) {
    return toArray;
  }
  return [...existing, ...toArray];
}

/**
 * Merges dependency maps that may be plain objects or factory functions (no config arg).
 * Covers all 4 combinations: obj+obj, fn+obj, obj+fn, fn+fn.
 */
export function mergeDepsNoConfig<
  TExisting extends DependencyMapType,
  TNew extends DependencyMapType,
>(
  existing: TExisting | (() => TExisting) | undefined,
  addition: TNew | (() => TNew),
  override: boolean,
): (TExisting & TNew) | (() => TExisting & TNew) {
  const isFnExisting = typeof existing === "function";
  const isFnAddition = typeof addition === "function";

  type Result = (TExisting & TNew) | (() => TExisting & TNew);

  if (override || !existing) {
    return addition as Result;
  }

  if (isFnExisting && isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as () => TNew;
    return (() => ({ ...e(), ...a() })) as Result;
  }
  if (isFnExisting && !isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as TNew;
    return (() => ({ ...e(), ...a })) as Result;
  }
  if (!isFnExisting && isFnAddition) {
    const e = existing as TExisting;
    const a = addition as () => TNew;
    return (() => ({ ...e, ...a() })) as Result;
  }
  const e = existing as TExisting;
  const a = addition as TNew;
  return { ...e, ...a } as Result;
}

/**
 * Merges dependency maps where factories receive a config argument.
 * Same merge matrix as `mergeDepsNoConfig` but with `(config: C) => Deps`.
 */
export function mergeDepsWithConfig<
  C,
  TExisting extends DependencyMapType,
  TNew extends DependencyMapType,
>(
  existing: TExisting | ((config: C) => TExisting) | undefined,
  addition: TNew | ((config: C) => TNew),
  override: boolean,
): (TExisting & TNew) | ((config: C) => TExisting & TNew) {
  const isFnExisting = typeof existing === "function";
  const isFnAddition = typeof addition === "function";

  type Result = (TExisting & TNew) | ((config: C) => TExisting & TNew);

  if (override || !existing) {
    return addition as Result;
  }

  if (isFnExisting && isFnAddition) {
    const e = existing as (config: C) => TExisting;
    const a = addition as (config: C) => TNew;
    return ((config: C) => ({ ...e(config), ...a(config) })) as Result;
  }
  if (isFnExisting && !isFnAddition) {
    const e = existing as (config: C) => TExisting;
    const a = addition as TNew;
    return ((config: C) => ({ ...e(config), ...a })) as Result;
  }
  if (!isFnExisting && isFnAddition) {
    const e = existing as TExisting;
    const a = addition as (config: C) => TNew;
    return ((config: C) => ({ ...e, ...a(config) })) as Result;
  }
  const e = existing as TExisting;
  const a = addition as TNew;
  return { ...e, ...a } as Result;
}
