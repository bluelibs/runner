import type { DependencyMapType } from "../../defs";

type CloneStatePatch<S, NS> = Partial<NS> &
  Pick<NS, Exclude<keyof NS, keyof S>>;

/**
 * Freeze and return a new state where `patch` can only omit keys already present in `s`.
 * This guarantees required keys introduced by `NS` are provided by the patch.
 */
export function cloneState<S extends Partial<NS>, NS extends object>(
  s: S,
  patch: CloneStatePatch<S, NS>,
): NS {
  return Object.freeze({ ...s, ...patch }) as NS;
}

export { mergeArray } from "./shared/mergeUtils";

// Merge dependency maps that may be objects or functions producing objects.
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

  if (override || !existing) {
    return addition as (TExisting & TNew) | (() => TExisting & TNew);
  }

  if (isFnExisting && isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as () => TNew;
    return (() => ({
      ...e(),
      ...a(),
    })) as () => TExisting & TNew;
  }
  if (isFnExisting && !isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as TNew;
    return (() => ({
      ...e(),
      ...a,
    })) as () => TExisting & TNew;
  }
  if (!isFnExisting && isFnAddition) {
    const e = existing as TExisting;
    const a = addition as () => TNew;
    return (() => ({
      ...e,
      ...a(),
    })) as () => TExisting & TNew;
  }
  const e = existing as TExisting;
  const a = addition as TNew;
  return { ...e, ...a } as TExisting & TNew;
}
