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
  SerializerSchemaClass,
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
  /**
   * Optional roles attached to the active identity.
   *
   * Runner does not interpret these automatically unless a task identity gate
   * or `middleware.task.identityChecker` explicitly requests them. If your app
   * models inherited roles, expand the effective role set before binding the
   * identity so the gate sees the right access surface.
   */
  roles?: readonly string[];
}

/**
 * Task-level identity gate requirement used by subtree policy and the built-in
 * identity checker middleware.
 *
 * Mentioning an identity requirement implies tenant identity by default, so
 * `{ user: true }` means tenant + user and `{ roles: ["ADMIN"] }` still
 * requires tenant presence.
 */
export interface IdentityRequirementConfig {
  /**
   * Tenant identity is required whenever an identity gate is present.
   *
   * The field is optional only for ergonomics; omitting it still behaves as
   * `tenant: true`.
   */
  tenant?: true;
  /**
   * Require `userId` in addition to `tenantId`.
   */
  user?: boolean;
  /**
   * Require at least one matching role on the active identity.
   *
   * Runner evaluates this as a flat OR list. If your app has role
   * inheritance, expand the effective roles before the identity reaches
   * Runner.
   */
  roles?: readonly string[];
}

/**
 * Value carried by `asyncContexts.identity`.
 *
 * This built-in context is the default runtime identity grouper. Apps can also
 * define their own `r.asyncContext(...).configSchema(...)` accessor and pass it
 * to `run(..., { identity })` when they want a custom runtime identity source.
 */
export interface IdentityContextValue extends IIdentity {}
