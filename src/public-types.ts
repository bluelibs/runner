export type {
  IPlatformAdapter,
  IAsyncLocalStorage,
  PlatformId,
  PlatformSetTimeout,
  PlatformClearTimeout,
} from "./platform";

export type {
  TaskFluentBuilder,
  ResolveInput,
  ShouldReplaceInput,
} from "./definers/builders/task";

export type { AsyncContextFluentBuilder } from "./definers/builders/asyncContext";
export type { ErrorFluentBuilder } from "./definers/builders/error";
export type { EventFluentBuilder } from "./definers/builders/event";
export type {
  EventLaneBuilderWithTopology,
  EventLaneFluentBuilder,
} from "./definers/builders/eventLane";
export type {
  HookFluentBuilder,
  ValidOnTarget,
  ResolvedOn,
} from "./definers/builders/hook";

export type {
  ResourceFluentBuilder,
  ResolveConfig,
  ShouldReplaceConfig,
} from "./definers/builders/resource";

export type {
  TaskMiddlewareFluentBuilder,
  ResourceMiddlewareFluentBuilder,
} from "./definers/builders/middleware";

export type { TagFluentBuilder } from "./definers/builders/tag";

export type {
  TypeDefinition,
  SerializerOptions,
  JsonPrimitive,
  ObjectReference,
  SerializedTypeRecord,
  SerializerLike,
  SerializedNode,
  SerializedValue,
  SerializationContext,
  DeserializationContext,
  SerializerSchemaLike,
  SerializerDeserializeOptions,
  SerializerFieldOptions,
  SerializerFieldDecorator,
} from "./serializer";

export type {
  ExecutionJournal,
  JournalKey,
  JournalSetOptions,
} from "./types/executionJournal";

export type {
  RuntimeCallSource,
  RuntimeCallSourceKind,
} from "./types/runtimeSource";

export type { ResourceCooldownAdmissionTargets } from "./types/resource";

export type { ITimerHandle, ITimers } from "./types/timers";

/**
 * Minimal tenant identity contract used by Runner's built-in tenant async context.
 */
export interface ITenant {
  /**
   * Stable non-empty tenant identifier used to partition tenant-aware state.
   */
  tenantId: string;
}

/**
 * Value carried by `asyncContexts.tenant`.
 *
 * Augment this interface when your app needs extra tenant metadata to flow
 * through `tenant.provide()`, `tenant.use()`, and `tenant.tryUse()`.
 */
export interface TenantContextValue extends ITenant {}
