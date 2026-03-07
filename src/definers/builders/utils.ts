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

export {
  mergeArray,
  mergeDepsNoConfig,
  mergeDepsWithConfig,
} from "./shared/mergeUtils";
