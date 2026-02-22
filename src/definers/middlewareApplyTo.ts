import type { MiddlewareApplyToScopeType } from "../defs";
import { validationError } from "../errors";

type ApplyTo<WhenFn extends (...args: any[]) => boolean> = Readonly<{
  scope: MiddlewareApplyToScopeType;
  when?: WhenFn;
}>;

type Everywhere<WhenFn extends (...args: any[]) => boolean> = boolean | WhenFn;

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
>(
  id: string,
  applyTo: ApplyTo<WhenFn> | undefined,
  everywhere: Everywhere<WhenFn> | undefined,
): {
  applyTo: ApplyTo<WhenFn> | undefined;
  everywhere: Everywhere<WhenFn> | undefined;
} {
  if (applyTo !== undefined && everywhere !== undefined) {
    return failApplyToValidation(
      id,
      "Cannot use both applyTo and everywhere together.",
    );
  }

  if (applyTo !== undefined) {
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

    const normalizedApplyTo: ApplyTo<WhenFn> = Object.freeze({
      scope,
      when: when as WhenFn | undefined,
    });
    return {
      applyTo: normalizedApplyTo,
      everywhere:
        scope === "where-visible"
          ? (normalizedApplyTo.when ?? true)
          : undefined,
    };
  }

  if (everywhere === undefined) {
    return { applyTo: undefined, everywhere: undefined };
  }

  if (everywhere === false) {
    return { applyTo: undefined, everywhere };
  }

  if (everywhere === true) {
    return {
      applyTo: Object.freeze({ scope: "where-visible" }),
      everywhere,
    };
  }

  if (typeof everywhere === "function") {
    return {
      applyTo: Object.freeze({
        scope: "where-visible",
        when: everywhere,
      }),
      everywhere,
    };
  }

  return failApplyToValidation(
    id,
    "everywhere must be boolean or function when provided.",
  );
}
