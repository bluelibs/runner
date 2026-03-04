import {
  isolateInvalidEntryError,
  isolateUnknownTargetError,
  isolateConflictError,
  isolateExportsUnknownTargetError,
  isolateInvalidExportsError,
  duplicateTagIdOnDefinitionError,
  duplicateRegistrationError,
  middlewareNotRegisteredError,
  eventLaneRpcLaneConflictError,
  transactionalEventLaneConflictError,
  transactionalParallelConflictError,
  subtreeValidationFailedError,
  tagSelfDependencyError,
  tagNotFoundError,
} from "../errors";
import { globalTags } from "../globals/globalTags";
import type {
  ITaggable,
  IsolationExportsTarget,
  IsolationPolicy,
  IsolationTarget,
  SubtreePolicyViolationRecord,
  SubtreeValidationTargetType,
  SubtreeViolation,
} from "../defs";
import { isOptional, isTag, isTagStartup, isSubtreeFilter } from "../define";
import { StoreRegistry } from "./StoreRegistry";
import { resolveIsolationSelector } from "./utils/isolationSelectors";
import {
  getSubtreeResourceMiddlewareAttachment,
  getSubtreeTaskMiddlewareAttachment,
} from "../tools/subtreeMiddleware";

type SanityCheckTaggable = ITaggable & {
  id: string;
  tags?: ITaggable["tags"];
};

type TaggableEntry = {
  definitionType: string;
  definition: SanityCheckTaggable;
};

export class StoreValidator {
  private readonly registeredIds = new Set<string>();

  constructor(private registry: StoreRegistry) {
    this.seedRegisteredIds();
  }

  trackRegisteredId(id: string): void {
    this.registeredIds.add(id);
  }

  checkIfIDExists(id: string): void | never {
    if (!this.registeredIds.has(id)) {
      return;
    }

    if (this.registry.tasks.has(id)) {
      duplicateRegistrationError.throw({ type: "Task", id });
    }
    if (this.registry.resources.has(id)) {
      duplicateRegistrationError.throw({ type: "Resource", id });
    }
    if (this.registry.events.has(id)) {
      duplicateRegistrationError.throw({ type: "Event", id });
    }
    if (this.registry.errors.has(id)) {
      duplicateRegistrationError.throw({ type: "Error", id });
    }
    if (this.registry.asyncContexts.has(id)) {
      duplicateRegistrationError.throw({ type: "AsyncContext", id });
    }
    if (this.registry.taskMiddlewares.has(id)) {
      duplicateRegistrationError.throw({ type: "Middleware", id });
    }
    if (this.registry.resourceMiddlewares.has(id)) {
      duplicateRegistrationError.throw({ type: "Middleware", id });
    }
    if (this.registry.tags.has(id)) {
      duplicateRegistrationError.throw({ type: "Tag", id });
    }
    if (this.registry.hooks.has(id)) {
      duplicateRegistrationError.throw({ type: "Hook", id });
    }

    duplicateRegistrationError.throw({ type: "Unknown", id });
  }

  runSanityChecks() {
    for (const task of this.registry.tasks.values()) {
      const middlewares = task.task.middleware;
      middlewares.forEach((middlewareAttachment) => {
        const middlewareId = this.resolveReferenceId(middlewareAttachment);
        if (!middlewareId || !this.registry.taskMiddlewares.has(middlewareId)) {
          middlewareNotRegisteredError.throw({
            type: "task",
            source: task.task.id,
            middlewareId: middlewareAttachment.id,
          });
        }
      });
    }

    for (const resource of this.registry.resources.values()) {
      const middlewares = resource.resource.middleware;
      middlewares.forEach((middlewareAttachment) => {
        const middlewareId = this.resolveReferenceId(middlewareAttachment);
        if (
          !middlewareId ||
          !this.registry.resourceMiddlewares.has(middlewareId)
        ) {
          middlewareNotRegisteredError.throw({
            type: "resource",
            source: resource.resource.id,
            middlewareId: middlewareAttachment.id,
          });
        }
      });
    }

    this.ensureTransactionalEventsAreValid();
    this.ensureEventLaneAndRpcLaneAreMutuallyExclusive();
    this.ensureSubtreePoliciesAreValid();
    this.ensureTagIdsAreUniquePerDefinition();
    this.ensureAllTagsUsedAreRegistered();
    this.ensureNoSelfTagDependencies();
    this.ensureIsolationPoliciesAreValid();

    // Validate module boundary visibility after all items are registered
    this.registry.visibilityTracker.validateVisibility(this.registry);
  }

  private ensureTransactionalEventsAreValid() {
    for (const { event } of this.registry.events.values()) {
      if (!event.transactional) {
        continue;
      }

      if (event.parallel) {
        transactionalParallelConflictError.throw({
          eventId: event.id,
        });
      }

      const hasEventLaneTag = event.tags.some(
        (tag) => this.resolveReferenceId(tag) === globalTags.eventLane.id,
      );
      if (hasEventLaneTag) {
        transactionalEventLaneConflictError.throw({
          eventId: event.id,
          tagId: globalTags.eventLane.id,
        });
      }
    }
  }

  private ensureEventLaneAndRpcLaneAreMutuallyExclusive() {
    for (const { event } of this.registry.events.values()) {
      const hasEventLaneTag = event.tags.some(
        (tag) => this.resolveReferenceId(tag) === globalTags.eventLane.id,
      );
      if (!hasEventLaneTag) {
        continue;
      }

      const hasRpcLaneTag = event.tags.some(
        (tag) => this.resolveReferenceId(tag) === globalTags.rpcLane.id,
      );
      if (!hasRpcLaneTag) {
        continue;
      }

      eventLaneRpcLaneConflictError.throw({
        eventId: event.id,
        eventLaneTagId: globalTags.eventLane.id,
        rpcLaneTagId: globalTags.rpcLane.id,
      });
    }
  }

  private ensureSubtreePoliciesAreValid() {
    const violations: SubtreePolicyViolationRecord[] = [];

    for (const {
      resource: ownerResource,
    } of this.registry.resources.values()) {
      const ownerResourceId = ownerResource.id;
      const subtreePolicy = ownerResource.subtree;
      if (!subtreePolicy) {
        continue;
      }

      for (const middlewareEntry of subtreePolicy.tasks?.middleware ?? []) {
        const middleware = getSubtreeTaskMiddlewareAttachment(middlewareEntry);
        const middlewareId = this.resolveReferenceId(middleware);
        if (!middlewareId || !this.registry.taskMiddlewares.has(middlewareId)) {
          middlewareNotRegisteredError.throw({
            type: "task",
            source: ownerResourceId,
            middlewareId: middleware.id,
          });
        }
      }

      for (const middlewareEntry of subtreePolicy.resources?.middleware ?? []) {
        const middleware =
          getSubtreeResourceMiddlewareAttachment(middlewareEntry);
        const middlewareId = this.resolveReferenceId(middleware);
        if (
          !middlewareId ||
          !this.registry.resourceMiddlewares.has(middlewareId)
        ) {
          middlewareNotRegisteredError.throw({
            type: "resource",
            source: ownerResourceId,
            middlewareId: middleware.id,
          });
        }
      }

      this.collectSubtreeValidationViolations(
        {
          ownerResourceId,
          validators: subtreePolicy.tasks?.validate ?? [],
          targetType: "task",
          entries: Array.from(this.registry.tasks.values()),
          getDefinition: (entry) => entry.task,
        },
        violations,
      );

      this.collectSubtreeValidationViolations(
        {
          ownerResourceId,
          validators: subtreePolicy.resources?.validate ?? [],
          targetType: "resource",
          entries: Array.from(this.registry.resources.values()),
          getDefinition: (entry) => entry.resource,
        },
        violations,
      );

      this.collectSubtreeValidationViolations(
        {
          ownerResourceId,
          validators: subtreePolicy.hooks?.validate ?? [],
          targetType: "hook",
          entries: Array.from(this.registry.hooks.values()),
          getDefinition: (entry) => entry.hook,
        },
        violations,
      );

      this.collectSubtreeValidationViolations(
        {
          ownerResourceId,
          validators: subtreePolicy.taskMiddleware?.validate ?? [],
          targetType: "task-middleware",
          entries: Array.from(this.registry.taskMiddlewares.values()),
          getDefinition: (entry) => entry.middleware,
        },
        violations,
      );

      this.collectSubtreeValidationViolations(
        {
          ownerResourceId,
          validators: subtreePolicy.resourceMiddleware?.validate ?? [],
          targetType: "resource-middleware",
          entries: Array.from(this.registry.resourceMiddlewares.values()),
          getDefinition: (entry) => entry.middleware,
        },
        violations,
      );

      this.collectSubtreeValidationViolations(
        {
          ownerResourceId,
          validators: subtreePolicy.events?.validate ?? [],
          targetType: "event",
          entries: Array.from(this.registry.events.values()),
          getDefinition: (entry) => entry.event,
        },
        violations,
      );

      this.collectSubtreeValidationViolations(
        {
          ownerResourceId,
          validators: subtreePolicy.tags?.validate ?? [],
          targetType: "tag",
          entries: Array.from(this.registry.tags.values()),
          getDefinition: (entry) => entry,
        },
        violations,
      );
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

  private collectSubtreeValidationViolations<TEntry, TDefinition>(
    input: {
      ownerResourceId: string;
      validators: Array<(definition: TDefinition) => SubtreeViolation[]>;
      targetType: SubtreeValidationTargetType;
      entries: Array<TEntry>;
      getDefinition: (entry: TEntry) => TDefinition;
    },
    violations: SubtreePolicyViolationRecord[],
  ): void {
    if (input.validators.length === 0) {
      return;
    }

    for (const entry of input.entries) {
      const definition = input.getDefinition(entry);
      const targetId = (definition as { id: string }).id;

      if (
        !this.registry.visibilityTracker.isWithinResourceSubtree(
          input.ownerResourceId,
          targetId,
        )
      ) {
        continue;
      }

      for (const validate of input.validators) {
        const validated = this.executeSubtreeValidator({
          ownerResourceId: input.ownerResourceId,
          targetType: input.targetType,
          targetId,
          run: () => validate(definition),
        });
        violations.push(...validated);
      }
    }
  }

  private executeSubtreeValidator(input: {
    ownerResourceId: string;
    targetType: SubtreeValidationTargetType;
    targetId: string;
    run: () => SubtreeViolation[];
  }): SubtreePolicyViolationRecord[] {
    try {
      const violations = input.run();
      if (!Array.isArray(violations)) {
        return [
          this.createInvalidSubtreeViolation(
            input,
            "Validator must return an array.",
          ),
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
        this.createInvalidSubtreeViolation(
          input,
          error instanceof Error ? error.message : String(error),
        ),
      ];
    }
  }

  private createInvalidSubtreeViolation(
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

  private ensureTagIdsAreUniquePerDefinition() {
    this.forEachTaggableEntry(({ definitionType, definition }) => {
      const tags = Array.isArray(definition.tags) ? definition.tags : [];
      const seenTagIds = new Set<string>();
      for (const tag of tags) {
        const tagId = this.resolveReferenceId(tag)!;
        if (seenTagIds.has(tagId)) {
          duplicateTagIdOnDefinitionError.throw({
            definitionType,
            definitionId: definition.id,
            tagId,
          });
        }
        seenTagIds.add(tagId);
      }
    });
  }

  ensureAllTagsUsedAreRegistered() {
    this.forEachTaggableEntry(({ definition }) => {
      const tags = Array.isArray(definition.tags) ? definition.tags : [];
      for (const tag of tags) {
        const tagId = this.resolveReferenceId(tag)!;
        if (!this.registry.tags.has(tagId)) {
          tagNotFoundError.throw({ id: tagId });
        }
      }
    });
  }

  private ensureNoSelfTagDependencies() {
    this.forEachSelfTagDependencyEntry((entry) => {
      if (!entry.dependencies || typeof entry.dependencies !== "object") {
        return;
      }

      const ownTagIds = new Set(
        (Array.isArray(entry.tags) ? entry.tags : []).map(
          (tag) => this.resolveReferenceId(tag)!,
        ),
      );
      for (const dependency of Object.values(
        entry.dependencies as Record<string, unknown>,
      )) {
        const maybeDependency = isOptional(dependency)
          ? (dependency as { inner: unknown }).inner
          : dependency;
        const maybeTag = isTagStartup(maybeDependency)
          ? maybeDependency.tag
          : maybeDependency;

        if (!isTag(maybeTag)) {
          continue;
        }

        const dependencyTagId = this.resolveReferenceId(maybeTag)!;

        if (!ownTagIds.has(dependencyTagId)) {
          continue;
        }

        tagSelfDependencyError.throw({
          definitionType: entry.definitionType,
          definitionId: entry.definitionId,
          tagId: dependencyTagId,
        });
      }
    });
  }

  private ensureIsolationPoliciesAreValid() {
    for (const { resource } of this.registry.resources.values()) {
      const policy = resource.isolate;
      if (!policy) {
        continue;
      }

      // When deny/only is provided it must be an array (guard against accidental misuse).
      const denyPresent = "deny" in policy && policy.deny !== undefined;
      const onlyPresent = "only" in policy && policy.only !== undefined;

      if (denyPresent && !Array.isArray(policy.deny)) {
        isolateInvalidEntryError.throw({
          policyResourceId: resource.id,
          entry: policy.deny,
        });
      }

      if (onlyPresent && !Array.isArray(policy.only)) {
        isolateInvalidEntryError.throw({
          policyResourceId: resource.id,
          entry: policy.only,
        });
      }

      const hasDeny = Array.isArray(policy.deny) && policy.deny.length > 0;
      const hasOnly = Array.isArray(policy.only) && policy.only.length > 0;

      const exportsPresent =
        "exports" in policy && policy.exports !== undefined;

      // Conflict is determined by field presence, not emptiness.
      // deny: [] alongside only: [A] is still an ambiguous declaration.
      if (denyPresent && onlyPresent) {
        isolateConflictError.throw({
          policyResourceId: resource.id,
        });
      }

      const normalizedPolicy: IsolationPolicy = {
        ...(denyPresent ? { deny: policy.deny } : {}),
        ...(onlyPresent ? { only: policy.only } : {}),
      };

      if (
        exportsPresent &&
        policy.exports !== "none" &&
        !Array.isArray(policy.exports)
      ) {
        isolateInvalidExportsError.throw({
          policyResourceId: resource.id,
          entry: policy.exports,
        });
      }

      if (Array.isArray(policy.exports)) {
        normalizedPolicy.exports =
          this.normalizeIsolationEntries<IsolationExportsTarget>({
            entries: policy.exports,
            onInvalidEntry: (entry) =>
              isolateInvalidExportsError.throw({
                policyResourceId: resource.id,
                entry,
              }),
            onUnknownTarget: (targetId) =>
              isolateExportsUnknownTargetError.throw({
                policyResourceId: resource.id,
                targetId,
              }),
          });
      } else if (policy.exports === "none") {
        normalizedPolicy.exports = "none";
      }

      const entries = hasDeny ? policy.deny! : hasOnly ? policy.only! : [];

      if (entries.length > 0) {
        const normalizedEntries =
          this.normalizeIsolationEntries<IsolationTarget>({
            entries,
            onInvalidEntry: (entry) =>
              isolateInvalidEntryError.throw({
                policyResourceId: resource.id,
                entry,
              }),
            onUnknownTarget: (targetId) =>
              isolateUnknownTargetError.throw({
                policyResourceId: resource.id,
                targetId,
              }),
          });

        if (hasDeny) {
          normalizedPolicy.deny = normalizedEntries;
        } else {
          normalizedPolicy.only = normalizedEntries;
        }
      }

      resource.isolate = normalizedPolicy;
      this.registry.visibilityTracker.recordIsolation(
        resource.id,
        normalizedPolicy,
      );

      if (Array.isArray(normalizedPolicy.exports)) {
        this.registry.visibilityTracker.recordExports(
          resource.id,
          normalizedPolicy.exports,
        );
      }
    }
  }

  private normalizeIsolationEntries<TEntry extends string | object>(input: {
    entries: ReadonlyArray<unknown>;
    onInvalidEntry: (entry: unknown) => never;
    onUnknownTarget: (targetId: string) => never;
  }): Array<TEntry> {
    const normalizedEntries: Array<TEntry> = [];
    const seenStringTargets = new Set<string>();

    const addStringTarget = (id: string) => {
      if (seenStringTargets.has(id)) {
        return;
      }
      seenStringTargets.add(id);
      normalizedEntries.push(id as TEntry);
    };

    for (const entry of input.entries) {
      // Structural subtree filters bypass the id-resolution path — we only
      // verify that the referenced resource is actually registered.
      if (isSubtreeFilter(entry)) {
        if (!this.hasRegisteredId(entry.resourceId)) {
          input.onUnknownTarget(entry.resourceId);
        }
        normalizedEntries.push(entry as unknown as TEntry);
        continue;
      }

      if (typeof entry === "string") {
        if (entry.length === 0) {
          input.onInvalidEntry(entry);
        }

        const resolvedIds = resolveIsolationSelector(entry, this.registeredIds);
        if (resolvedIds.length === 0) {
          input.onUnknownTarget(entry);
        }

        for (const resolvedId of resolvedIds) {
          addStringTarget(resolvedId);
        }
        continue;
      }

      const resolvedId = this.resolveIsolationTargetId(entry);
      if (!resolvedId) {
        input.onInvalidEntry(entry);
      } else if (!this.hasRegisteredId(resolvedId)) {
        input.onUnknownTarget(resolvedId);
      }

      if (isTag(entry)) {
        normalizedEntries.push(
          (entry.id === resolvedId
            ? entry
            : { ...entry, id: resolvedId }) as TEntry,
        );
        continue;
      }

      normalizedEntries.push(resolvedId as unknown as TEntry);
    }

    return normalizedEntries;
  }

  private resolveIsolationTargetId(entry: unknown): string | null {
    const resolved = this.resolveReferenceId(entry);
    return resolved ?? null;
  }

  private hasRegisteredId(id: string): boolean {
    return this.registeredIds.has(id);
  }

  private resolveReferenceId(entry: unknown): string | null {
    const resolved = this.registry.resolveDefinitionId(entry);
    if (resolved && resolved.length > 0) {
      return resolved;
    }

    return null;
  }

  private seedRegisteredIds() {
    const registries = [
      this.registry.tasks,
      this.registry.resources,
      this.registry.events,
      this.registry.errors,
      this.registry.asyncContexts,
      this.registry.taskMiddlewares,
      this.registry.resourceMiddlewares,
      this.registry.tags,
      this.registry.hooks,
    ];

    for (const collection of registries) {
      for (const id of collection.keys()) {
        this.registeredIds.add(id);
      }
    }
  }

  private forEachTaggableEntry(callback: (entry: TaggableEntry) => void): void {
    for (const { task } of this.registry.tasks.values()) {
      callback({ definitionType: "Task", definition: task });
    }
    for (const { resource } of this.registry.resources.values()) {
      callback({ definitionType: "Resource", definition: resource });
    }
    for (const { event } of this.registry.events.values()) {
      callback({ definitionType: "Event", definition: event });
    }
    for (const { middleware } of this.registry.taskMiddlewares.values()) {
      callback({ definitionType: "Task middleware", definition: middleware });
    }
    for (const { middleware } of this.registry.resourceMiddlewares.values()) {
      callback({
        definitionType: "Resource middleware",
        definition: middleware,
      });
    }
    for (const { hook } of this.registry.hooks.values()) {
      callback({ definitionType: "Hook", definition: hook });
    }
  }

  private forEachSelfTagDependencyEntry(
    callback: (entry: {
      definitionType: string;
      definitionId: string;
      tags: ITaggable["tags"];
      dependencies: unknown;
    }) => void,
  ): void {
    for (const { task } of this.registry.tasks.values()) {
      callback({
        definitionType: "Task",
        definitionId: task.id,
        tags: task.tags,
        dependencies: task.dependencies,
      });
    }
    for (const { resource } of this.registry.resources.values()) {
      callback({
        definitionType: "Resource",
        definitionId: resource.id,
        tags: resource.tags,
        dependencies: resource.dependencies,
      });
    }
    for (const { hook } of this.registry.hooks.values()) {
      callback({
        definitionType: "Hook",
        definitionId: hook.id,
        tags: hook.tags,
        dependencies: hook.dependencies,
      });
    }
    for (const { middleware } of this.registry.taskMiddlewares.values()) {
      callback({
        definitionType: "Task middleware",
        definitionId: middleware.id,
        tags: middleware.tags,
        dependencies: middleware.dependencies,
      });
    }
    for (const { middleware } of this.registry.resourceMiddlewares.values()) {
      callback({
        definitionType: "Resource middleware",
        definitionId: middleware.id,
        tags: middleware.tags,
        dependencies: middleware.dependencies,
      });
    }
  }
}
