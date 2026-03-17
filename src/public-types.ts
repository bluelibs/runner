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
 * Minimal identity payload Runner understands for identity-aware framework
 * behavior.
 *
 * `tenantId` and `userId` are both optional at the ambient context level so
 * apps can establish identity gradually across request/auth boundaries.
 * Middleware that opts into identity partitioning validates the fields it
 * actually needs at use time.
 */
export interface IIdentity {
  /**
   * Stable tenant identifier used to partition tenant-aware framework state
   * when present.
   */
  tenantId?: string;
  /**
   * Stable authenticated user identifier used by user-aware identity scopes
   * when present.
   */
  userId?: string;
}

/**
 * Value carried by `asyncContexts.identity`.
 *
 * This built-in context is the default runtime identity grouper. Apps can also
 * define their own `r.asyncContext(...).configSchema(...)` accessor and pass it
 * to `run(..., { identity })` when they want a custom runtime identity source.
 */
export interface IdentityContextValue extends IIdentity {}
