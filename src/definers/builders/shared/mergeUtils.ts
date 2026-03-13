import type { DependencyMapType } from "../../../defs";
import type { RunnerMode } from "../../../types/runner";

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
  existing:
    | TExisting
    | ((config: C, mode: RunnerMode) => TExisting)
    | undefined,
  addition: TNew | ((config: C, mode: RunnerMode) => TNew),
  override: boolean,
): (TExisting & TNew) | ((config: C, mode: RunnerMode) => TExisting & TNew) {
  const isFnExisting = typeof existing === "function";
  const isFnAddition = typeof addition === "function";

  type Result =
    | (TExisting & TNew)
    | ((config: C, mode: RunnerMode) => TExisting & TNew);

  if (override || !existing) {
    return addition as Result;
  }

  if (isFnExisting && isFnAddition) {
    const e = existing as (config: C, mode: RunnerMode) => TExisting;
    const a = addition as (config: C, mode: RunnerMode) => TNew;
    return ((config: C, mode: RunnerMode) => ({
      ...e(config, mode),
      ...a(config, mode),
    })) as Result;
  }
  if (isFnExisting && !isFnAddition) {
    const e = existing as (config: C, mode: RunnerMode) => TExisting;
    const a = addition as TNew;
    return ((config: C, mode: RunnerMode) => ({
      ...e(config, mode),
      ...a,
    })) as Result;
  }
  if (!isFnExisting && isFnAddition) {
    const e = existing as TExisting;
    const a = addition as (config: C, mode: RunnerMode) => TNew;
    return ((config: C, mode: RunnerMode) => ({
      ...e,
      ...a(config, mode),
    })) as Result;
  }
  const e = existing as TExisting;
  const a = addition as TNew;
  return { ...e, ...a } as Result;
}
