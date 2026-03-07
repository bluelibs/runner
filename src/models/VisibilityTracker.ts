import {
  RegisterableItems,
  IResourceWithConfig,
  IsolationPolicy,
  IsolationSubtreeFilter,
  ItemType,
  IsolationChannel,
  DependencyMapType,
} from "../defs";
import * as utils from "../define";
import {
  classifyIsolationEntry,
  classifyScopeTarget,
} from "../tools/classifyIsolationEntry";
import type { ClassifiedScopeTarget } from "../tools/classifyIsolationEntry";
import { isolateViolationError, visibilityViolationError } from "../errors";
import { StoreRegistry } from "./StoreRegistry";
import {
  getSubtreeResourceMiddlewareAttachment,
  getSubtreeTaskMiddlewareAttachment,
} from "../tools/subtreeMiddleware";
import { validationError } from "../errors";

/**
 * Per-channel set of concrete ids, tag ids, and subtree filters
 * that a single deny or only axis has accumulated.
 */
type CompiledChannelSets = {
  ids: Set<string>;
  tagIds: Set<string>;
  subtreeFilters: IsolationSubtreeFilter[];
};

const ALL_CHANNELS: readonly IsolationChannel[] = [
  "dependencies",
  "listening",
  "tagging",
  "middleware",
] as const;

type ItemTypeRegistryKey =
  | "tasks"
  | "resources"
  | "events"
  | "hooks"
  | "taskMiddlewares"
  | "resourceMiddlewares"
  | "tags"
  | "errors"
  | "asyncContexts";

const ITEM_TYPE_REGISTRY_KEYS = [
  ["tasks", "Task"],
  ["resources", "Resource"],
  ["events", "Event"],
  ["hooks", "Hook"],
  ["taskMiddlewares", "Task middleware"],
  ["resourceMiddlewares", "Resource middleware"],
  ["tags", "Tag"],
  ["errors", "Error"],
  ["asyncContexts", "Async context"],
] as const satisfies ReadonlyArray<readonly [ItemTypeRegistryKey, string]>;

function emptyChannelSets(): CompiledChannelSets {
  return { ids: new Set(), tagIds: new Set(), subtreeFilters: [] };
}

function emptyChannelRecord(): Record<IsolationChannel, CompiledChannelSets> {
  return {
    dependencies: emptyChannelSets(),
    listening: emptyChannelSets(),
    tagging: emptyChannelSets(),
    middleware: emptyChannelSets(),
  };
}

function forEachEnabledChannel(
  channels: Readonly<Record<IsolationChannel, boolean>>,
  run: (channel: IsolationChannel) => void,
): void {
  for (const channel of ALL_CHANNELS) {
    if (!channels[channel]) {
      continue;
    }
    run(channel);
  }
}

type CompiledIsolationPolicy = {
  deny: Record<IsolationChannel, CompiledChannelSets>;
  onlyMode: boolean;
  only: Record<IsolationChannel, CompiledChannelSets>;
};

type AccessViolation =
  | {
      kind: "visibility";
      targetOwnerResourceId: string;
      exportedIds: string[];
    }
  | {
      kind: "isolate";
      policyResourceId: string;
      matchedRuleType: "id" | "tag" | "only" | "subtree";
      matchedRuleId: string;
      channel: IsolationChannel;
    };

type DependencyValidationEntry = {
  consumerId: string;
  consumerType: string;
  dependencies: DependencyMapType | undefined;
};

type TagValidationEntry = {
  consumerId: string;
  consumerType: string;
  tags: unknown;
};

type MiddlewareVisibilityEntry = {
  consumerId: string;
  consumerType: string;
  targetType: string;
  targetIds: string[];
};

/**
 * Maps a registerable item to its Runner ItemType string.
 * Needed so subtreeOf({ types: ["task"] }) can filter by item kind at violation-check time.
 */
function deriveItemType(item: RegisterableItems): ItemType | undefined {
  if (utils.isTask(item)) return "task";
  if (utils.isResource(item) || utils.isResourceWithConfig(item))
    return "resource";
  if (utils.isEvent(item) || utils.isEventLane(item) || utils.isRpcLane(item))
    return "event";
  if (utils.isTag(item)) return "tag";
  if (utils.isHook(item)) return "hook";
  if (utils.isTaskMiddleware(item)) return "taskMiddleware";
  if (utils.isResourceMiddleware(item)) return "resourceMiddleware";
  return undefined;
}

/**
 * Extracts the string id from any registerable item.
 */
function getItemId(item: RegisterableItems): string | undefined {
  // Guard against non-object values smuggled in via `as any` at registration boundaries
  if (!item || (typeof item !== "object" && typeof item !== "function")) {
    return undefined;
  }
  if (utils.isResourceWithConfig(item)) {
    return (item as IResourceWithConfig).resource.id;
  }
  if ("id" in item) {
    return (item as { id: string }).id;
  }
  return undefined;
}

/**
 * Determines the human-readable type label for a registerable item.
 */
function getItemTypeLabel(registry: StoreRegistry, id: string): string {
  for (const [registryKey, label] of ITEM_TYPE_REGISTRY_KEYS) {
    if (registry[registryKey].has(id)) {
      return label;
    }
  }

  throw validationError.new({
    subject: "VisibilityTracker target type",
    id,
    originalError:
      "Unable to resolve a registered item type label for the target id. This indicates an inconsistent visibility-validation state.",
  });
}

function resolveReferenceId(
  registry: StoreRegistry,
  reference: unknown,
): string | undefined {
  const resolved = registry.resolveDefinitionId(reference);
  if (!resolved || resolved.length === 0) {
    return undefined;
  }
  return resolved;
}

/**
 * Tracks which resource owns (registered) each item and which items
 * are exported by resources that declare an exports list.
 *
 * Ownership is established during registration: when resource R calls
 * `.register([item])`, item is "owned" by R.
 *
 * When R declares isolate exports, only those items are visible
 * to items outside R's registration subtree.
 */
export class VisibilityTracker {
  /**
   * Maps item id → id of the resource that directly registered it.
   * Items registered by the root resource have the root's id as owner.
   */
  private readonly ownership = new Map<string, string>();

  /**
   * For each resource that declares exports: resource id → Set of
   * exported item ids. Resources without isolate exports are absent
   * from this map (meaning "everything is public").
   */
  private readonly exportSets = new Map<string, Set<string>>();

  /**
   * Maps resource id → set of all item ids in its registration subtree
   * (including items registered by nested child resources).
   */
  private readonly subtrees = new Map<string, Set<string>>();

  /**
   * Registered resource ids. Used to detect consumer resource boundaries
   * (including root resources with no owner).
   */
  private readonly knownResources = new Set<string>();

  /**
   * Resource id -> compiled additive isolation policy.
   */
  private readonly isolationPolicies = new Map<
    string,
    CompiledIsolationPolicy
  >();

  /**
   * Definition id -> tag ids carried by that definition.
   */
  private readonly definitionTagIds = new Map<string, Set<string>>();

  /**
   * Definition id -> its Runner item type (task, event, resource, etc.).
   * Used to evaluate `subtreeOf()` type filters without needing the registry.
   */
  private readonly itemTypes = new Map<string, ItemType>();

  recordResource(resourceId: string): void {
    this.knownResources.add(resourceId);
  }

  recordDefinitionTags(
    definitionId: string,
    tags: ReadonlyArray<{ id: string }>,
  ): void {
    if (!tags || tags.length === 0) {
      this.definitionTagIds.delete(definitionId);
      return;
    }

    this.definitionTagIds.set(definitionId, new Set(tags.map((tag) => tag.id)));
  }

  recordIsolation(resourceId: string, policy?: IsolationPolicy): void {
    this.knownResources.add(resourceId);

    const hasDeny = Array.isArray(policy?.deny) && policy!.deny!.length > 0;
    // "only mode" is active whenever the only field is an array, even if empty.
    const onlyPresent = policy !== undefined && Array.isArray(policy.only);

    if (!hasDeny && !onlyPresent) {
      this.isolationPolicies.delete(resourceId);
      return;
    }

    const deny = emptyChannelRecord();
    const only = emptyChannelRecord();

    const addClassifiedTarget = (
      classified: ClassifiedScopeTarget,
      channels: Readonly<Record<IsolationChannel, boolean>>,
      channelRecord: Record<IsolationChannel, CompiledChannelSets>,
    ) => {
      switch (classified.kind) {
        case "subtreeFilter":
          // Resolved lazily at violation-check time so overrides and late children are included.
          forEachEnabledChannel(channels, (channel) => {
            channelRecord[channel].subtreeFilters.push(classified.filter);
          });
          break;
        case "tag":
          forEachEnabledChannel(channels, (channel) => {
            channelRecord[channel].tagIds.add(classified.id);
          });
          break;
        case "string":
          forEachEnabledChannel(channels, (channel) => {
            channelRecord[channel].ids.add(classified.value);
          });
          break;
        case "definition":
          forEachEnabledChannel(channels, (channel) => {
            channelRecord[channel].ids.add(classified.id);
          });
          break;
        // "unknown" entries are silently skipped — validation already caught them.
      }
    };

    const allOn = {
      dependencies: true,
      listening: true,
      tagging: true,
      middleware: true,
    } as const;

    const compileEntry = (
      entry: unknown,
      channelRecord: Record<IsolationChannel, CompiledChannelSets>,
    ) => {
      const classified = classifyIsolationEntry(entry);
      if (classified.kind === "scope") {
        for (const target of classified.scope.targets) {
          addClassifiedTarget(
            classifyScopeTarget(target),
            classified.scope.channels,
            channelRecord,
          );
        }
        return;
      }
      addClassifiedTarget(classified, allOn, channelRecord);
    };

    if (hasDeny) {
      for (const entry of policy!.deny!) {
        compileEntry(entry, deny);
      }
    }

    if (onlyPresent) {
      for (const entry of policy!.only!) {
        compileEntry(entry, only);
      }
    }

    this.isolationPolicies.set(resourceId, {
      deny,
      onlyMode: onlyPresent,
      only,
    });
  }

  /**
   * Records ownership when a resource registers an item.
   */
  recordOwnership(ownerResourceId: string, item: RegisterableItems): void {
    const id = getItemId(item);
    if (!id) return;

    // Keep first ownership immutable. If the same id is registered again,
    // StoreValidator will fail the duplicate registration; overwriting here
    // can create ownership cycles before that error is thrown.
    if (this.ownership.has(id)) {
      return;
    }

    this.ownership.set(id, ownerResourceId);

    const type = deriveItemType(item);
    if (type) this.itemTypes.set(id, type);

    // Add to owner's subtree and all ancestor subtrees
    const visitedOwners = new Set<string>();
    let current: string | undefined = ownerResourceId;
    while (current !== undefined && !visitedOwners.has(current)) {
      visitedOwners.add(current);
      let subtree = this.subtrees.get(current);
      if (!subtree) {
        subtree = new Set();
        this.subtrees.set(current, subtree);
      }
      subtree.add(id);
      // Walk up to the resource's own owner (parent)
      current = this.ownership.get(current);
    }
  }

  /**
   * Records the export set for a resource that declares isolate exports.
   */
  recordExports(
    resourceId: string,
    exports: Array<RegisterableItems | string>,
  ): void {
    const ids = new Set<string>();
    for (const item of exports) {
      if (typeof item === "string") {
        ids.add(item);
        continue;
      }

      const id = getItemId(item);
      if (id) ids.add(id);
    }
    this.exportSets.set(resourceId, ids);
  }

  /**
   * Checks whether a target id is visible through the root resource's export
   * surface for runtime API calls (runTask, emitEvent, getResourceValue, etc.).
   *
   * When the root has no isolate exports declaration the surface is fully open
   * (backward compatible). Otherwise only explicitly listed ids are reachable.
   *
   * Returns both the accessibility result and the current exported id list so
   * callers can produce a useful remediation message without a second lookup.
   */
  getRootAccessInfo(
    targetId: string,
    rootId: string,
  ): { accessible: boolean; exportedIds: string[] } {
    const exportSet = this.exportSets.get(rootId);
    // No export declaration on root → fully open (backward compat)
    if (exportSet === undefined) return { accessible: true, exportedIds: [] };
    return { accessible: exportSet.has(targetId), exportedIds: [...exportSet] };
  }

  /**
   * Checks whether `consumerId` can access `targetId`.
   *
   * An item is accessible if:
   * 1. The target's owner has no exports list (everything is public), OR
   * 2. The consumer is inside the same registration subtree as the target, OR
   * 3. The target is in the owner resource's export set (transitively up).
   */
  isAccessible(
    targetId: string,
    consumerId: string,
    channel: IsolationChannel = "dependencies",
  ): boolean {
    return this.getAccessViolation(targetId, consumerId, channel) === null;
  }

  getAccessViolation(
    targetId: string,
    consumerId: string,
    channel: IsolationChannel = "dependencies",
  ): AccessViolation | null {
    const targetOwner = this.ownership.get(targetId);

    if (targetOwner !== undefined) {
      const visibilityAllowed = this.isAccessibleFromOwnerChain(
        targetId,
        consumerId,
        targetOwner,
        undefined,
      );

      if (!visibilityAllowed) {
        return {
          kind: "visibility",
          targetOwnerResourceId: targetOwner,
          exportedIds: [...this.findGatingExportSet(targetId, targetOwner)],
        };
      }
    }

    return this.findIsolationViolation(targetId, consumerId, channel);
  }

  private isAccessibleFromOwnerChain(
    targetId: string,
    consumerId: string,
    ownerId: string,
    boundaryOwnerId: string | undefined,
    seenPaths: Set<string> = new Set<string>(),
  ): boolean {
    // A resource can always access items in its own registration scope.
    if (consumerId === ownerId) return true;

    // If the consumer is inside the owner's subtree, it has full access
    const ownerSubtree = this.subtrees.get(ownerId);
    if (ownerSubtree?.has(consumerId)) return true;

    const exportSet = this.exportSets.get(ownerId);
    if (
      exportSet &&
      !this.isTargetAllowedByExports(targetId, ownerId, seenPaths)
    ) {
      return false;
    }

    if (ownerId === boundaryOwnerId) {
      return true;
    }

    const parentOwner = this.ownership.get(ownerId);
    if (parentOwner === undefined) {
      return boundaryOwnerId === undefined;
    }

    return this.isAccessibleFromOwnerChain(
      targetId,
      consumerId,
      parentOwner,
      boundaryOwnerId,
      seenPaths,
    );
  }

  private isTargetAllowedByExports(
    targetId: string,
    ownerId: string,
    seenPaths: Set<string> = new Set<string>(),
  ): boolean {
    const exportSet = this.exportSets.get(ownerId)!;
    if (exportSet.has(targetId)) return true;

    // If this resource exports a child resource, the child's own exported
    // surface is transitively visible at this boundary.
    for (const exportedId of exportSet) {
      const traversalKey = `${ownerId}::${exportedId}::${targetId}`;
      if (seenPaths.has(traversalKey)) continue;
      seenPaths.add(traversalKey);

      if (
        this.isVisibleOutsideExportedResource(
          targetId,
          exportedId,
          ownerId,
          seenPaths,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  private isVisibleOutsideExportedResource(
    targetId: string,
    exportedResourceId: string,
    ownerId: string,
    seenPaths: Set<string>,
  ): boolean {
    const exportedSubtree = this.subtrees.get(exportedResourceId);
    if (!exportedSubtree?.has(targetId)) return false;

    const targetOwner = this.ownership.get(targetId)!;

    // For transitive checks we evaluate visibility from "outside the exported
    // resource but inside the owner".
    return this.isAccessibleFromOwnerChain(
      targetId,
      ownerId,
      targetOwner,
      exportedResourceId,
      seenPaths,
    );
  }

  /**
   * Validates that all dependency references respect visibility boundaries.
   * Called after registration is complete, before dependency computation.
   */
  validateVisibility(registry: StoreRegistry): void {
    this.validateItemDependencies(registry);
    this.validateHookEventVisibility(registry);
    this.validateTaggingVisibility(registry);
    this.validateMiddlewareVisibility(registry);
  }

  /**
   * Checks dependencies declared by all dependency-bearing definitions.
   */
  private validateItemDependencies(registry: StoreRegistry): void {
    for (const entry of this.collectDependencyEntries(registry)) {
      this.validateReferenceIds(registry, {
        consumerId: entry.consumerId,
        consumerType: entry.consumerType,
        channel: "dependencies",
        targetIds: this.resolveDependencyReferenceIds(
          registry,
          entry.dependencies,
        ),
        targetType: (targetId) => getItemTypeLabel(registry, targetId),
      });
    }
  }

  /**
   * Validates that hook listeners only subscribe to visible events.
   */
  private validateHookEventVisibility(registry: StoreRegistry): void {
    for (const { hook } of registry.hooks.values()) {
      if (!hook.on) continue;

      const events =
        hook.on === "*"
          ? Array.from(registry.events.values()).map((entry) => entry.event)
          : Array.isArray(hook.on)
            ? hook.on
            : [hook.on];
      this.validateReferenceIds(registry, {
        consumerId: hook.id,
        consumerType: "Hook",
        channel: "listening",
        targetIds: this.resolveReferenceIds(registry, events),
        targetType: "Event",
      });
    }
  }

  /**
   * Validates that tag attachments are visible to the attaching definition.
   */
  private validateTaggingVisibility(registry: StoreRegistry): void {
    for (const entry of this.collectTagEntries(registry)) {
      this.validateReferenceIds(registry, {
        consumerId: entry.consumerId,
        consumerType: entry.consumerType,
        channel: "tagging",
        targetIds: this.resolveTagReferenceIds(registry, entry.tags),
        targetType: "Tag",
      });
    }
  }

  /**
   * Validates that middleware attachments are visible.
   */
  private validateMiddlewareVisibility(registry: StoreRegistry): void {
    for (const entry of this.collectMiddlewareVisibilityEntries(registry)) {
      this.validateReferenceIds(registry, {
        consumerId: entry.consumerId,
        consumerType: entry.consumerType,
        channel: "middleware",
        targetIds: entry.targetIds,
        targetType: entry.targetType,
      });
    }
  }

  private collectDependencyEntries(
    registry: StoreRegistry,
  ): DependencyValidationEntry[] {
    return [
      ...Array.from(registry.tasks.values(), ({ task }) => ({
        consumerId: task.id,
        consumerType: "Task",
        dependencies: task.dependencies,
      })),
      ...Array.from(registry.resources.values(), ({ resource }) => ({
        consumerId: resource.id,
        consumerType: "Resource",
        dependencies: resource.dependencies,
      })),
      ...Array.from(registry.hooks.values(), ({ hook }) => ({
        consumerId: hook.id,
        consumerType: "Hook",
        dependencies: hook.dependencies,
      })),
      ...Array.from(registry.taskMiddlewares.values(), ({ middleware }) => ({
        consumerId: middleware.id,
        consumerType: "Task middleware",
        dependencies: middleware.dependencies,
      })),
      ...Array.from(
        registry.resourceMiddlewares.values(),
        ({ middleware }) => ({
          consumerId: middleware.id,
          consumerType: "Resource middleware",
          dependencies: middleware.dependencies,
        }),
      ),
    ];
  }

  private collectTagEntries(registry: StoreRegistry): TagValidationEntry[] {
    return [
      ...Array.from(registry.tasks.values(), ({ task }) => ({
        consumerId: task.id,
        consumerType: "Task",
        tags: task.tags,
      })),
      ...Array.from(registry.resources.values(), ({ resource }) => ({
        consumerId: resource.id,
        consumerType: "Resource",
        tags: resource.tags,
      })),
      ...Array.from(registry.events.values(), ({ event }) => ({
        consumerId: event.id,
        consumerType: "Event",
        tags: event.tags,
      })),
      ...Array.from(registry.hooks.values(), ({ hook }) => ({
        consumerId: hook.id,
        consumerType: "Hook",
        tags: hook.tags,
      })),
      ...Array.from(registry.taskMiddlewares.values(), ({ middleware }) => ({
        consumerId: middleware.id,
        consumerType: "Task middleware",
        tags: middleware.tags,
      })),
      ...Array.from(
        registry.resourceMiddlewares.values(),
        ({ middleware }) => ({
          consumerId: middleware.id,
          consumerType: "Resource middleware",
          tags: middleware.tags,
        }),
      ),
    ];
  }

  private collectMiddlewareVisibilityEntries(
    registry: StoreRegistry,
  ): MiddlewareVisibilityEntry[] {
    return [
      ...Array.from(registry.tasks.values(), ({ task }) => ({
        consumerId: task.id,
        consumerType: "Task",
        targetType: "Task middleware",
        targetIds: this.resolveReferenceIds(registry, task.middleware),
      })),
      ...Array.from(registry.resources.values(), ({ resource }) => ({
        consumerId: resource.id,
        consumerType: "Resource",
        targetType: "Resource middleware",
        targetIds: this.resolveReferenceIds(registry, resource.middleware),
      })),
      ...Array.from(registry.resources.values(), ({ resource }) => ({
        consumerId: resource.id,
        consumerType: "Resource",
        targetType: "Task middleware",
        targetIds: this.resolveSubtreeMiddlewareReferenceIds(
          registry,
          resource.subtree?.tasks?.middleware ?? [],
          getSubtreeTaskMiddlewareAttachment,
        ),
      })),
      ...Array.from(registry.resources.values(), ({ resource }) => ({
        consumerId: resource.id,
        consumerType: "Resource",
        targetType: "Resource middleware",
        targetIds: this.resolveSubtreeMiddlewareReferenceIds(
          registry,
          resource.subtree?.resources?.middleware ?? [],
          getSubtreeResourceMiddlewareAttachment,
        ),
      })),
    ];
  }

  private validateReferenceIds(
    registry: StoreRegistry,
    options: {
      consumerId: string;
      consumerType: string;
      channel: IsolationChannel;
      targetIds: Iterable<string>;
      targetType: string | ((targetId: string) => string);
    },
  ): void {
    const { consumerId, consumerType, channel, targetIds, targetType } =
      options;

    for (const targetId of targetIds) {
      const violation = this.getAccessViolation(targetId, consumerId, channel);
      if (!violation) {
        continue;
      }

      this.throwAccessViolation(registry, {
        violation,
        targetId,
        targetType:
          typeof targetType === "function" ? targetType(targetId) : targetType,
        consumerId,
        consumerType,
      });
    }
  }

  private resolveDependencyReferenceIds(
    registry: StoreRegistry,
    dependencies: DependencyMapType | undefined,
  ): string[] {
    if (!dependencies) {
      return [];
    }

    const ids: string[] = [];

    for (const [, depDef] of Object.entries(dependencies)) {
      const dep = utils.isOptional(depDef)
        ? (depDef as { inner: unknown }).inner
        : depDef;
      // Runtime guard: optional unwrapping yields `unknown`, so primitives can slip through
      const depId =
        dep && typeof dep === "object"
          ? resolveReferenceId(registry, dep)
          : undefined;

      if (depId) {
        ids.push(depId);
      }
    }

    return ids;
  }

  private resolveTagReferenceIds(
    registry: StoreRegistry,
    tags: unknown,
  ): string[] {
    if (!Array.isArray(tags) || tags.length === 0) {
      return [];
    }

    return this.resolveReferenceIds(registry, tags);
  }

  private resolveReferenceIds(
    registry: StoreRegistry,
    references: Iterable<unknown>,
  ): string[] {
    const ids: string[] = [];

    for (const reference of references) {
      const resolvedId = resolveReferenceId(registry, reference);
      if (resolvedId) {
        ids.push(resolvedId);
      }
    }

    return ids;
  }

  private resolveSubtreeMiddlewareReferenceIds<TEntry>(
    registry: StoreRegistry,
    entries: readonly TEntry[],
    getAttachment: (entry: TEntry) => { id: string },
  ): string[] {
    return this.resolveReferenceIds(
      registry,
      entries.map((entry) => getAttachment(entry)),
    );
  }

  private findIsolationViolation(
    targetId: string,
    consumerId: string,
    channel: IsolationChannel,
  ): Extract<AccessViolation, { kind: "isolate" }> | null {
    const chain = this.getConsumerResourceChain(consumerId);
    if (chain.length === 0) {
      return null;
    }

    const targetTags = this.definitionTagIds.get(targetId);

    for (const policyResourceId of chain) {
      const policy = this.isolationPolicies.get(policyResourceId);
      if (!policy) {
        continue;
      }

      const denySets = policy.deny[channel];

      // --- deny rules (channel-scoped) ---
      if (denySets.ids.has(targetId)) {
        return {
          kind: "isolate",
          policyResourceId,
          matchedRuleType: "id",
          matchedRuleId: targetId,
          channel,
        };
      }

      if (denySets.tagIds.has(targetId)) {
        return {
          kind: "isolate",
          policyResourceId,
          matchedRuleType: "tag",
          matchedRuleId: targetId,
          channel,
        };
      }

      if (targetTags) {
        for (const tagId of targetTags) {
          if (!denySets.tagIds.has(tagId)) {
            continue;
          }

          return {
            kind: "isolate",
            policyResourceId,
            matchedRuleType: "tag",
            matchedRuleId: tagId,
            channel,
          };
        }
      }

      // --- deny subtree filters ---
      for (const filter of denySets.subtreeFilters) {
        if (!this.matchesSubtreeFilter(targetId, filter)) continue;
        return {
          kind: "isolate",
          policyResourceId,
          matchedRuleType: "subtree",
          matchedRuleId: filter.resourceId,
          channel,
        };
      }

      // --- only rules: internal items (within the policy resource's subtree) are always allowed ---
      if (!policy.onlyMode) {
        continue;
      }

      const policySubtree = this.subtrees.get(policyResourceId);
      const isInternal =
        targetId === policyResourceId || policySubtree?.has(targetId) === true;

      if (isInternal) {
        continue;
      }

      const onlySets = policy.only[channel];

      // External target must match the only list (by id, tag, or subtree filter).
      const matchedByOnlyId = onlySets.ids.has(targetId);
      const matchedByOnlyTag =
        onlySets.tagIds.has(targetId) ||
        (targetTags !== undefined &&
          [...targetTags].some((tagId) => onlySets.tagIds.has(tagId)));
      const matchedByOnlySubtree = onlySets.subtreeFilters.some((filter) =>
        this.matchesSubtreeFilter(targetId, filter),
      );

      if (!matchedByOnlyId && !matchedByOnlyTag && !matchedByOnlySubtree) {
        return {
          kind: "isolate",
          policyResourceId,
          matchedRuleType: "only",
          matchedRuleId: targetId,
          channel,
        };
      }
    }

    return null;
  }

  /**
   * Checks whether `targetId` falls within a subtree filter's scope,
   * accounting for the resource itself and optional type narrowing.
   */
  private matchesSubtreeFilter(
    targetId: string,
    filter: IsolationSubtreeFilter,
  ): boolean {
    const filterSubtree = this.subtrees.get(filter.resourceId);
    // The resource itself is not in its own subtrees map, so check both.
    const inFilterSubtree =
      targetId === filter.resourceId || filterSubtree?.has(targetId);
    if (!inFilterSubtree) return false;
    if (filter.types && filter.types.length > 0) {
      const targetType = this.itemTypes.get(targetId);
      if (!targetType || !filter.types.includes(targetType)) return false;
    }
    return true;
  }

  private getConsumerResourceChain(consumerId: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();

    let current: string | undefined = this.knownResources.has(consumerId)
      ? consumerId
      : this.ownership.get(consumerId);

    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      current = this.ownership.get(current);
    }

    return chain;
  }

  private throwAccessViolation(
    registry: StoreRegistry,
    data: {
      violation: AccessViolation;
      targetId: string;
      targetType: string;
      consumerId: string;
      consumerType: string;
    },
  ): void {
    const { violation, targetId, targetType, consumerId, consumerType } = data;
    const toDisplayId = (id: string): string => registry.getDisplayId(id);
    const displayTargetId = toDisplayId(targetId);
    const displayConsumerId = toDisplayId(consumerId);

    if (violation.kind === "visibility") {
      visibilityViolationError.throw({
        targetId: displayTargetId,
        targetType,
        ownerResourceId: toDisplayId(violation.targetOwnerResourceId),
        consumerId: displayConsumerId,
        consumerType,
        exportedIds: violation.exportedIds.map(toDisplayId),
      });
    } else {
      isolateViolationError.throw({
        targetId: displayTargetId,
        targetType,
        consumerId: displayConsumerId,
        consumerType,
        policyResourceId: toDisplayId(violation.policyResourceId),
        matchedRuleType: violation.matchedRuleType,
        matchedRuleId: toDisplayId(violation.matchedRuleId),
        channel: violation.channel,
      });
    }
  }

  /**
   * Finds the first export set in the ownership chain that gates `targetId`.
   */
  private findGatingExportSet(targetId: string, ownerId: string): Set<string> {
    const exportSet = this.exportSets.get(ownerId);
    if (exportSet && !this.isTargetAllowedByExports(targetId, ownerId)) {
      return exportSet;
    }
    const parentOwner = this.ownership.get(ownerId);
    if (parentOwner === undefined) return new Set<string>();
    return this.findGatingExportSet(targetId, parentOwner);
  }

  /**
   * Returns the owner resource id for an item id.
   */
  getOwnerResourceId(itemId: string): string | undefined {
    return this.ownership.get(itemId);
  }

  /**
   * Returns true when `itemId` is the same resource or is registered inside
   * the resource's registration subtree.
   */
  isWithinResourceSubtree(resourceId: string, itemId: string): boolean {
    if (resourceId === itemId) {
      return true;
    }
    return this.subtrees.get(resourceId)?.has(itemId) === true;
  }

  rollbackOwnershipTree(itemId: string): void {
    const toRemove = new Set<string>();
    if (this.ownership.has(itemId)) {
      toRemove.add(itemId);
    }

    let added = true;
    while (added) {
      added = false;
      for (const [id, ownerId] of this.ownership.entries()) {
        if (!toRemove.has(id) && toRemove.has(ownerId)) {
          toRemove.add(id);
          added = true;
        }
      }
    }

    if (toRemove.size === 0) {
      return;
    }

    for (const id of toRemove) {
      this.ownership.delete(id);
      this.exportSets.delete(id);
      this.subtrees.delete(id);
      this.knownResources.delete(id);
      this.isolationPolicies.delete(id);
      this.definitionTagIds.delete(id);
      this.itemTypes.delete(id);
    }

    for (const subtree of this.subtrees.values()) {
      for (const id of toRemove) {
        subtree.delete(id);
      }
    }
  }
}
