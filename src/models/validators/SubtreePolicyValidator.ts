import { subtreeValidationFailedError } from "../../errors";
import type {
  NormalizedResourceSubtreePolicy,
  SubtreePolicyViolationRecord,
  SubtreeValidationTargetType,
  SubtreeValidatableElement,
  SubtreeViolation,
} from "../../defs";
import { getStoredSubtreePolicy } from "../../definers/subtreePolicy";
import type { ValidatorContext } from "./ValidatorContext";

/**
 * Validates subtree policies defined on resources.
 * Collects violations from user-defined validators and throws aggregated error.
 */
export function validateSubtreePolicies(ctx: ValidatorContext): void {
  const violations: SubtreePolicyViolationRecord[] = [];
  const subtreeEntries = collectSubtreeValidationEntries(ctx);

  for (const { resource: ownerResource } of ctx.registry.resources.values()) {
    const subtree = getStoredSubtreePolicy(ownerResource);
    const ownerResourceId = ownerResource.id;
    const genericValidators = subtree?.validate ?? [];
    if (genericValidators.length === 0) {
      if (
        !subtree?.tasks?.validate?.length &&
        !subtree?.resources?.validate?.length &&
        !subtree?.hooks?.validate?.length &&
        !subtree?.events?.validate?.length &&
        !subtree?.tags?.validate?.length &&
        !subtree?.taskMiddleware?.validate?.length &&
        !subtree?.resourceMiddleware?.validate?.length
      ) {
        continue;
      }
    }

    for (const { definition, targetType } of subtreeEntries) {
      const targetId = definition.id;
      if (
        !ctx.registry.visibilityTracker.isWithinResourceSubtree(
          ownerResourceId,
          targetId,
        )
      ) {
        continue;
      }

      const validators = [
        ...genericValidators,
        ...getTypedValidators(subtree!, targetType),
      ];

      for (const validate of validators) {
        const validated = executeSubtreeValidator({
          ownerResourceId,
          targetType,
          targetId,
          run: () => validate(definition as never),
        });
        violations.push(...validated);
      }
    }
  }

  if (violations.length === 0) {
    return;
  }

  subtreeValidationFailedError.throw({
    violations: violations.map((entry) => ({
      ownerResourceId: entry.ownerResourceId,
      targetType: entry.targetType,
      targetId: entry.targetId,
      code: entry.violation.code,
      message: entry.violation.message,
    })),
  });
}

function getTypedValidators(
  subtree: NormalizedResourceSubtreePolicy,
  targetType: SubtreeValidationTargetType,
): Array<(definition: unknown) => SubtreeViolation[]> {
  switch (targetType) {
    case "task":
      return (subtree.tasks?.validate ?? []) as Array<
        (definition: unknown) => SubtreeViolation[]
      >;
    case "resource":
      return (subtree.resources?.validate ?? []) as Array<
        (definition: unknown) => SubtreeViolation[]
      >;
    case "hook":
      return (subtree.hooks?.validate ?? []) as Array<
        (definition: unknown) => SubtreeViolation[]
      >;
    case "event":
      return (subtree.events?.validate ?? []) as Array<
        (definition: unknown) => SubtreeViolation[]
      >;
    case "tag":
      return (subtree.tags?.validate ?? []) as Array<
        (definition: unknown) => SubtreeViolation[]
      >;
    case "task-middleware":
      return (subtree.taskMiddleware?.validate ?? []) as Array<
        (definition: unknown) => SubtreeViolation[]
      >;
    case "resource-middleware":
      return (subtree.resourceMiddleware?.validate ?? []) as Array<
        (definition: unknown) => SubtreeViolation[]
      >;
  }
}

function collectSubtreeValidationEntries(ctx: ValidatorContext): Array<{
  definition: SubtreeValidatableElement;
  targetType: SubtreeValidationTargetType;
}> {
  const entries: Array<{
    definition: SubtreeValidatableElement;
    targetType: SubtreeValidationTargetType;
  }> = [];

  for (const { task } of ctx.registry.tasks.values()) {
    entries.push({ definition: task, targetType: "task" });
  }
  for (const { resource } of ctx.registry.resources.values()) {
    entries.push({ definition: resource, targetType: "resource" });
  }
  for (const { hook } of ctx.registry.hooks.values()) {
    entries.push({ definition: hook, targetType: "hook" });
  }
  for (const { middleware } of ctx.registry.taskMiddlewares.values()) {
    entries.push({
      definition: middleware,
      targetType: "task-middleware",
    });
  }
  for (const { middleware } of ctx.registry.resourceMiddlewares.values()) {
    entries.push({
      definition: middleware,
      targetType: "resource-middleware",
    });
  }
  for (const { event } of ctx.registry.events.values()) {
    entries.push({ definition: event, targetType: "event" });
  }
  for (const tag of ctx.registry.tags.values()) {
    entries.push({ definition: tag, targetType: "tag" });
  }

  return entries;
}

function executeSubtreeValidator(input: {
  ownerResourceId: string;
  targetType: SubtreeValidationTargetType;
  targetId: string;
  run: () => SubtreeViolation[];
}): SubtreePolicyViolationRecord[] {
  try {
    const violations = input.run();
    if (!Array.isArray(violations)) {
      return [
        createInvalidSubtreeViolation(input, "Validator must return an array."),
      ];
    }

    return violations.map((violation) => ({
      ownerResourceId: input.ownerResourceId,
      targetType: input.targetType,
      targetId: input.targetId,
      violation,
    }));
  } catch (error) {
    return [
      createInvalidSubtreeViolation(
        input,
        error instanceof Error ? error.message : String(error),
      ),
    ];
  }
}

function createInvalidSubtreeViolation(
  input: {
    ownerResourceId: string;
    targetType: SubtreeValidationTargetType;
    targetId: string;
  },
  message: string,
): SubtreePolicyViolationRecord {
  return {
    ownerResourceId: input.ownerResourceId,
    targetType: input.targetType,
    targetId: input.targetId,
    violation: {
      code: "invalid-definition",
      message,
    },
  };
}
