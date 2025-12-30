import type { DependencyMapType } from "../../defs";

// Freezes and returns a new builder state with a patch applied, preserving typing.
export function cloneState<S, NS>(s: S, patch: Partial<NS>): NS {
  return Object.freeze({
    ...(s as unknown as NS),
    ...(patch as Partial<NS>),
  }) as NS;
}

// Merge arrays with optional override (replace vs append)
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
    return addition as any as (TExisting & TNew) | (() => TExisting & TNew);
  }

  if (isFnExisting && isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as () => TNew;
    return (() => ({ ...(e() as any), ...(a() as any) })) as any;
  }
  if (isFnExisting && !isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as TNew;
    return (() => ({ ...(e() as any), ...(a as any) })) as any;
  }
  if (!isFnExisting && isFnAddition) {
    const e = existing as TExisting;
    const a = addition as () => TNew;
    return (() => ({ ...(e as any), ...(a() as any) })) as any;
  }
  const e = existing as TExisting;
  const a = addition as TNew;
  return { ...(e as any), ...(a as any) } as any;
}
