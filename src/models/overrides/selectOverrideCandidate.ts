import { isResource } from "../../define";
import { overrideDuplicateTargetError } from "../../errors";
import { RunnerMode } from "../../types/runner";
import type { StoreRegistry } from "../store/StoreRegistry";
import type { SupportedOverride } from "./overrideDefinition";

/** A declaration paired with its registration scope. @internal */
export type OverrideCandidate = {
  /** Canonical id of the declaring resource. */
  source: string;
  /** Replacement definition retaining the original target reference. */
  override: SupportedOverride;
};

/** Disjoint resource scopes are independent; overlapping scopes retain the test-only duplicate policy. */
export function selectOverrideCandidate(
  registry: StoreRegistry,
  candidates: readonly OverrideCandidate[],
  candidate: OverrideCandidate,
): OverrideCandidate {
  const within = (ancestor: string, descendant: string) =>
    registry.visibilityTracker.isWithinResourceSubtree(ancestor, descendant);
  const conflicts = candidates.filter(
    (existing) =>
      !isResource(candidate.override) ||
      within(existing.source, candidate.source) ||
      within(candidate.source, existing.source),
  );
  if (registry.getStoreMode() !== RunnerMode.TEST && conflicts.length > 0) {
    overrideDuplicateTargetError.throw({
      targetId: candidate.override.id,
      sources: [
        ...new Set([
          ...conflicts.map((entry) => entry.source),
          candidate.source,
        ]),
      ],
    });
  }
  // Resource sibling winners are selected per consumer later by the scope compiler.
  return [...candidates, candidate].reduce((winner, next) =>
    within(next.source, winner.source) ? next : winner,
  );
}
