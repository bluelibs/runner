import { getClassSchemaDefinition } from "./classSchema";
import { collectMatchFailures } from "./matcher";
import {
  ClassPattern,
  LazyPattern,
  MapOfPattern,
  MaybePattern,
  NonEmptyArrayPattern,
  ObjectIncludingPattern,
  ObjectStrictPattern,
  OneOfPattern,
  OptionalPattern,
  WithErrorPolicyPattern,
  WithMessagePattern,
} from "./matcher";
import {
  copyHydratedProperty,
  getHydratedReference,
  getSeenHydratedValue,
  patternCanHydrate,
  rememberHydratedValue,
} from "./hydration.helpers";
import { resolveClassAllowUnknownKeys } from "./matcher/shared";
import { isPlainObject } from "../typeChecks";

type HydrationState = {
  seen: WeakMap<object, unknown>;
};

function createState(): HydrationState {
  return { seen: new WeakMap<object, unknown>() };
}

function hydrateObjectShape(
  value: Record<string, unknown>,
  pattern: Record<string, unknown>,
  allowUnknownKeys: boolean,
  state: HydrationState,
  target: object = Object.create(Object.getPrototypeOf(value)),
): object {
  const existing = getSeenHydratedValue(value, state.seen);
  if (existing !== undefined) {
    return existing as object;
  }

  // Store the shell before hydrating children so self-references can point
  // back to the final instance instead of recursing forever.
  rememberHydratedValue(value, target, state.seen);

  for (const [key, childPattern] of Object.entries(pattern)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }

    copyHydratedProperty(
      target,
      key,
      hydrateMatchedValue(value[key], childPattern, state),
    );
  }

  if (!allowUnknownKeys) {
    return target;
  }

  for (const key of Object.keys(value)) {
    if (key in pattern) {
      continue;
    }

    copyHydratedProperty(
      target,
      key,
      getHydratedReference(value[key], state.seen),
    );
  }

  return target;
}

function hydrateArray(
  value: readonly unknown[],
  pattern: unknown,
  state: HydrationState,
): unknown[] {
  const existing = getSeenHydratedValue(value, state.seen);
  if (existing !== undefined) {
    return existing as unknown[];
  }

  const result: unknown[] = new Array(value.length);
  rememberHydratedValue(value, result, state.seen);

  for (let index = 0; index < value.length; index += 1) {
    result[index] = hydrateMatchedValue(value[index], pattern, state);
  }

  return result;
}

function hydrateMapObject(
  value: Record<string, unknown>,
  valuePattern: unknown,
  state: HydrationState,
): Record<string, unknown> {
  const existing = getSeenHydratedValue(value, state.seen);
  if (existing !== undefined) {
    return existing as Record<string, unknown>;
  }

  const result: Record<string, unknown> = Object.create(
    Object.getPrototypeOf(value),
  );
  rememberHydratedValue(value, result, state.seen);

  for (const key of Object.keys(value)) {
    copyHydratedProperty(
      result,
      key,
      hydrateMatchedValue(value[key], valuePattern, state),
    );
  }

  return result;
}

function hydrateOneOf(
  value: unknown,
  pattern: OneOfPattern<readonly unknown[]>,
  state: HydrationState,
): unknown {
  for (const candidate of pattern.patterns) {
    if (collectMatchFailures(value, candidate, false).length === 0) {
      return hydrateMatchedValue(value, candidate, state);
    }
  }

  return value;
}

export function hydrateMatchedValue(
  value: unknown,
  pattern: unknown,
  state: HydrationState = createState(),
): unknown {
  // Avoid constructors during parse-time hydration so schema parsing stays a
  // pure shape/materialization step with deterministic behavior.
  if (!patternCanHydrate(pattern)) {
    return value;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (pattern instanceof OptionalPattern || pattern instanceof MaybePattern) {
    return hydrateMatchedValue(value, pattern.pattern, state);
  }
  if (
    pattern instanceof WithMessagePattern ||
    pattern instanceof WithErrorPolicyPattern
  ) {
    return hydrateMatchedValue(value, pattern.pattern, state);
  }
  if (pattern instanceof LazyPattern) {
    return hydrateMatchedValue(value, pattern.resolve(), state);
  }
  if (pattern instanceof OneOfPattern) {
    return hydrateOneOf(value, pattern, state);
  }
  if (pattern instanceof ClassPattern) {
    if (!isPlainObject(value)) {
      return value;
    }

    const classSchema = getClassSchemaDefinition(pattern.ctor);
    return hydrateObjectShape(
      value,
      classSchema.pattern,
      resolveClassAllowUnknownKeys(pattern.options?.exact, classSchema.exact),
      state,
      // Validation already proved the shape; hydration should only attach the
      // class prototype and field values, not run user constructors.
      Object.create(pattern.ctor.prototype),
    );
  }
  if (pattern instanceof NonEmptyArrayPattern) {
    if (!Array.isArray(value)) {
      return value;
    }

    return hydrateArray(value, pattern.pattern, state);
  }
  if (pattern instanceof MapOfPattern) {
    if (!isPlainObject(value)) {
      return value;
    }

    return hydrateMapObject(value, pattern.pattern, state);
  }
  if (pattern instanceof ObjectIncludingPattern) {
    if (!isPlainObject(value)) {
      return value;
    }

    return hydrateObjectShape(value, pattern.pattern, true, state);
  }
  if (pattern instanceof ObjectStrictPattern) {
    if (!isPlainObject(value)) {
      return value;
    }

    return hydrateObjectShape(value, pattern.pattern, false, state);
  }
  if (Array.isArray(pattern)) {
    if (!Array.isArray(value)) {
      return value;
    }

    return hydrateArray(value, pattern[0], state);
  }
  if (isPlainObject(pattern)) {
    if (!isPlainObject(value)) {
      return value;
    }

    return hydrateObjectShape(value, pattern, false, state);
  }

  return value;
}
