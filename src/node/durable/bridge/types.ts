import type { IEvent, IEventDefinition } from "../../../types/event";
import type { IResource } from "../../../types/resource";
import type { DurableResource } from "../core/DurableResource";
import type { RuntimeCallSource } from "../../../types/runtimeSource";
import type { ExecutionRetention } from "../core/retention";

/** A registered resource hosting a durable runtime. */
export type DurableEventResource = IResource<
  any,
  Promise<DurableResource>,
  any,
  any,
  any,
  any,
  any
>;

/** Event-level durable dispatch policy. */
export interface DurableEventConfig {
  /** Opt out of broad bridge selectors. Defaults to true. */
  enabled?: boolean;
  /** Explicit compatibility version for persisted hook plans. Defaults to "1". */
  version?: string;
  /** Overrides the bridge's default durable resource. */
  durable?: DurableEventResource;
  /** Requires every participating hook to declare compensation. */
  compensation?: "required";
  /** Overrides successful-execution retention for this event. */
  retention?: ExecutionRetention;
}

/** Runtime-owned event routing policy. */
export interface DurableEventBridgeConfig {
  /** Default backend; inferred when exactly one visible runtime exists. */
  defaultDurable?: DurableEventResource;
  /** Additional definitions selected once at bootstrap. Tagged events are always included. */
  applyTo?:
    | "all"
    | readonly IEventDefinition<any>[]
    | ((event: IEvent<any>) => boolean);
  /** Default retention for bridged executions. */
  retention?: ExecutionRetention;
}

/** Persisted event dispatch input; contains no resource values or closures. */
export interface DurableEventInput {
  /** Canonical event definition identity. */
  eventId: string;
  /** Canonical owning durable resource identity. */
  resourceId: string;
  /** Frozen ordered canonical hook membership. */
  hookIds: string[];
  /** Explicit plan compatibility version. */
  version: string;
  /** Serializer-validated event payload. */
  data: unknown;
  /** Original emission time, preserved on replay. */
  timestamp: Date;
  /** Original caller identity for tracing and self-skip semantics. */
  source: RuntimeCallSource;
  /** Whether successful hooks must be reversed on terminal failure. */
  compensation: boolean;
}
