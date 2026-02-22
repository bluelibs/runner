import type { MiddlewareApplyToScopeType } from "../defs";

type ApplyToConfig<TTarget> = Readonly<{
  scope: MiddlewareApplyToScopeType;
  when?: (target: TTarget) => boolean;
}>;

type AutoApplyConfig<TTarget> = Readonly<{
  id: string;
  applyTo?: ApplyToConfig<TTarget>;
  everywhere?: boolean | ((target: TTarget) => boolean);
}>;

type AutoApplyMatcherOptions = Readonly<{
  isVisibleToTarget: (middlewareId: string, targetId: string) => boolean;
  isInSubtreeScope: (middlewareId: string, targetId: string) => boolean;
}>;

function getNormalizedApplyTo<TTarget>(
  middleware: AutoApplyConfig<TTarget>,
): ApplyToConfig<TTarget> | undefined {
  if (middleware.applyTo) {
    return middleware.applyTo;
  }

  const legacy = middleware.everywhere;
  if (!legacy) {
    return undefined;
  }

  return {
    scope: "where-visible",
    when: typeof legacy === "function" ? legacy : undefined,
  };
}

export function isMiddlewareAutoAppliedToTarget<
  TTarget extends {
    id: string;
  },
>(
  middleware: AutoApplyConfig<TTarget>,
  target: TTarget,
  options: AutoApplyMatcherOptions,
): boolean {
  const applyTo = getNormalizedApplyTo(middleware);
  if (!applyTo) {
    return false;
  }

  if (applyTo.scope === "where-visible") {
    if (!options.isVisibleToTarget(middleware.id, target.id)) {
      return false;
    }
  } else if (applyTo.scope === "subtree") {
    if (!options.isInSubtreeScope(middleware.id, target.id)) {
      return false;
    }
  } else {
    return false;
  }

  if (applyTo.when) {
    return applyTo.when(target);
  }

  return true;
}
