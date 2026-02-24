import type {
  NormalizedResourceSubtreeEventPolicy,
  NormalizedResourceSubtreeHookPolicy,
  NormalizedResourceSubtreePolicy,
  NormalizedResourceSubtreeResourceMiddlewarePolicy,
  NormalizedResourceSubtreeTagPolicy,
  NormalizedResourceSubtreeTaskMiddlewarePolicy,
  ResourceSubtreePolicy,
  SubtreeEventValidator,
  SubtreeHookValidator,
  SubtreeResourceMiddlewareValidator,
  SubtreeResourceValidator,
  SubtreeTagValidator,
  SubtreeTaskMiddlewareValidator,
  SubtreeTaskValidator,
} from "../types/subtree";

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? [...value] : [value];
}

export function normalizeResourceSubtreePolicy(
  policy: ResourceSubtreePolicy | undefined,
): NormalizedResourceSubtreePolicy | undefined {
  if (!policy) {
    return;
  }

  const normalized: NormalizedResourceSubtreePolicy = {};
  if (policy.tasks) {
    normalized.tasks = {
      middleware: [...(policy.tasks.middleware ?? [])],
      validate: toArray<SubtreeTaskValidator>(policy.tasks.validate),
    };
  }

  if (policy.resources) {
    normalized.resources = {
      middleware: [...(policy.resources.middleware ?? [])],
      validate: toArray<SubtreeResourceValidator>(policy.resources.validate),
    };
  }

  if (policy.hooks) {
    normalized.hooks = {
      validate: toArray<SubtreeHookValidator>(policy.hooks.validate),
    };
  }

  if (policy.taskMiddleware) {
    normalized.taskMiddleware = {
      validate: toArray<SubtreeTaskMiddlewareValidator>(
        policy.taskMiddleware.validate,
      ),
    };
  }

  if (policy.resourceMiddleware) {
    normalized.resourceMiddleware = {
      validate: toArray<SubtreeResourceMiddlewareValidator>(
        policy.resourceMiddleware.validate,
      ),
    };
  }

  if (policy.events) {
    normalized.events = {
      validate: toArray<SubtreeEventValidator>(policy.events.validate),
    };
  }

  if (policy.tags) {
    normalized.tags = {
      validate: toArray<SubtreeTagValidator>(policy.tags.validate),
    };
  }

  return normalized;
}

function mergeSubtreeTasksBranch(
  existing: NormalizedResourceSubtreePolicy["tasks"],
  incoming: NonNullable<NormalizedResourceSubtreePolicy["tasks"]>,
  override: boolean,
): NonNullable<NormalizedResourceSubtreePolicy["tasks"]> {
  if (!existing || override) {
    return {
      middleware: [...incoming.middleware],
      validate: [...incoming.validate],
    };
  }

  return {
    middleware: [...existing.middleware, ...incoming.middleware],
    validate: [...existing.validate, ...incoming.validate],
  };
}

function mergeSubtreeResourcesBranch(
  existing: NormalizedResourceSubtreePolicy["resources"],
  incoming: NonNullable<NormalizedResourceSubtreePolicy["resources"]>,
  override: boolean,
): NonNullable<NormalizedResourceSubtreePolicy["resources"]> {
  if (!existing || override) {
    return {
      middleware: [...incoming.middleware],
      validate: [...incoming.validate],
    };
  }

  return {
    middleware: [...existing.middleware, ...incoming.middleware],
    validate: [...existing.validate, ...incoming.validate],
  };
}

function mergeSubtreeValidateOnlyBranch<
  TBranch extends {
    validate: unknown[];
  },
>(
  existing: TBranch | undefined,
  incoming: TBranch,
  override: boolean,
): TBranch {
  if (!existing || override) {
    return {
      validate: [...incoming.validate],
    } as TBranch;
  }

  return {
    validate: [...existing.validate, ...incoming.validate],
  } as TBranch;
}

export function mergeResourceSubtreePolicy(
  existing: NormalizedResourceSubtreePolicy | undefined,
  incoming: ResourceSubtreePolicy,
  options?: {
    override?: boolean;
  },
): NormalizedResourceSubtreePolicy {
  const normalizedIncoming = normalizeResourceSubtreePolicy(incoming);
  if (!normalizedIncoming) {
    return existing ? { ...existing } : {};
  }

  const override = options?.override === true;
  const merged: NormalizedResourceSubtreePolicy = {
    ...(existing
      ? {
          tasks: existing.tasks
            ? {
                middleware: [...existing.tasks.middleware],
                validate: [...existing.tasks.validate],
              }
            : undefined,
          resources: existing.resources
            ? {
                middleware: [...existing.resources.middleware],
                validate: [...existing.resources.validate],
              }
            : undefined,
          hooks: existing.hooks
            ? {
                validate: [...existing.hooks.validate],
              }
            : undefined,
          taskMiddleware: existing.taskMiddleware
            ? {
                validate: [...existing.taskMiddleware.validate],
              }
            : undefined,
          resourceMiddleware: existing.resourceMiddleware
            ? {
                validate: [...existing.resourceMiddleware.validate],
              }
            : undefined,
          events: existing.events
            ? {
                validate: [...existing.events.validate],
              }
            : undefined,
          tags: existing.tags
            ? {
                validate: [...existing.tags.validate],
              }
            : undefined,
        }
      : {}),
  };

  if (normalizedIncoming.tasks) {
    merged.tasks = mergeSubtreeTasksBranch(
      merged.tasks,
      normalizedIncoming.tasks,
      override,
    );
  }

  if (normalizedIncoming.resources) {
    merged.resources = mergeSubtreeResourcesBranch(
      merged.resources,
      normalizedIncoming.resources,
      override,
    );
  }

  if (normalizedIncoming.hooks) {
    merged.hooks =
      mergeSubtreeValidateOnlyBranch<NormalizedResourceSubtreeHookPolicy>(
        merged.hooks,
        normalizedIncoming.hooks,
        override,
      );
  }

  if (normalizedIncoming.taskMiddleware) {
    merged.taskMiddleware =
      mergeSubtreeValidateOnlyBranch<NormalizedResourceSubtreeTaskMiddlewarePolicy>(
        merged.taskMiddleware,
        normalizedIncoming.taskMiddleware,
        override,
      );
  }

  if (normalizedIncoming.resourceMiddleware) {
    merged.resourceMiddleware =
      mergeSubtreeValidateOnlyBranch<NormalizedResourceSubtreeResourceMiddlewarePolicy>(
        merged.resourceMiddleware,
        normalizedIncoming.resourceMiddleware,
        override,
      );
  }

  if (normalizedIncoming.events) {
    merged.events =
      mergeSubtreeValidateOnlyBranch<NormalizedResourceSubtreeEventPolicy>(
        merged.events,
        normalizedIncoming.events,
        override,
      );
  }

  if (normalizedIncoming.tags) {
    merged.tags =
      mergeSubtreeValidateOnlyBranch<NormalizedResourceSubtreeTagPolicy>(
        merged.tags,
        normalizedIncoming.tags,
        override,
      );
  }

  return merged;
}
