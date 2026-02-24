import type { MiddlewareApplyToScopeType } from "../defs";
import { validationError } from "../errors";

type ApplyTo<WhenFn extends (...args: any[]) => boolean> = Readonly<{
  scope: MiddlewareApplyToScopeType;
  when?: WhenFn;
}>;

const APPLY_TO_SCOPES: readonly MiddlewareApplyToScopeType[] = [
  "where-visible",
  "subtree",
];

function isApplyToScope(value: unknown): value is MiddlewareApplyToScopeType {
  return (
    typeof value === "string" &&
    APPLY_TO_SCOPES.includes(value as MiddlewareApplyToScopeType)
  );
}

function failApplyToValidation(id: string, originalError: string): never {
  return validationError.throw({
    subject: "Middleware applyTo",
    id,
    originalError,
  });
}

export function normalizeMiddlewareApplyTo<
  WhenFn extends (...args: any[]) => boolean,
>(id: string, applyTo: ApplyTo<WhenFn>): ApplyTo<WhenFn> {
  const scope = (applyTo as { scope?: unknown }).scope;
  if (!isApplyToScope(scope)) {
    return failApplyToValidation(
      id,
      `Invalid applyTo.scope "${String(scope)}". Expected "where-visible" or "subtree".`,
    );
  }

  const when = (applyTo as { when?: unknown }).when;
  if (when !== undefined && typeof when !== "function") {
    return failApplyToValidation(
      id,
      "applyTo.when must be a function when provided.",
    );
  }

  return Object.freeze({
    scope,
    when: when as WhenFn | undefined,
  });
}
