import type { DependencyMapType } from "../../defs";

// Freezes and returns a new builder state with a patch applied, preserving typing.
export function cloneState<S, NS>(s: S, patch: Partial<NS>): NS {
  return Object.freeze({
    ...(s as unknown as NS),
    ...(patch as Partial<NS>),
  }) as NS;
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
    return addition as unknown as (TExisting & TNew) | (() => TExisting & TNew);
  }

  if (isFnExisting && isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as () => TNew;
    return (() => ({
      ...e(),
      ...a(),
    })) as unknown as () => TExisting & TNew;
  }
  if (isFnExisting && !isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as TNew;
    return (() => ({
      ...e(),
      ...a,
    })) as unknown as () => TExisting & TNew;
  }
  if (!isFnExisting && isFnAddition) {
    const e = existing as TExisting;
    const a = addition as () => TNew;
    return (() => ({
      ...e,
      ...a(),
    })) as unknown as () => TExisting & TNew;
  }
  const e = existing as TExisting;
  const a = addition as TNew;
  return { ...e, ...a } as unknown as TExisting & TNew;
}
