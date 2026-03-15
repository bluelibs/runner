import type {
  IEventLaneDefinition,
  IEventLaneTopology,
  IEventLaneTopologyProfile,
  IResource,
  RemoteLaneBindingAuth,
  RuntimeCallSource,
} from "../../defs";
import type { RemoteLanesMode } from "../remote-lanes/mode";

export interface EventLaneMessage {
  id: string;
  laneId: string;
  eventId: string;
  payload: string;
  /** Serializer-encoded async-context map forwarded by the producing lane. */
  serializedAsyncContexts?: string;
  source: RuntimeCallSource;
  authToken?: string;
  createdAt: Date;
  attempts: number;
  maxAttempts: number;
}

export type EventLaneMessageHandler = (
  message: EventLaneMessage,
) => Promise<void>;

export interface IEventLaneQueue {
  enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string>;
  consume(handler: EventLaneMessageHandler): Promise<void>;
  cooldown?(): Promise<void>;
  ack(messageId: string): Promise<void>;
  nack(messageId: string, requeue?: boolean): Promise<void>;
  setPrefetch?(count: number): Promise<void>;
  init?(): Promise<void>;
  dispose?(): Promise<void>;
}

export type EventLaneQueueResource = IResource<
  any,
  any,
  any,
  any,
  any,
  any,
  any
>;

export type EventLaneQueueReference = IEventLaneQueue | EventLaneQueueResource;

export interface EventLaneBinding {
  lane: IEventLaneDefinition;
  queue: EventLaneQueueReference;
  auth?: RemoteLaneBindingAuth;
  prefetch?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export type EventLaneProfileConfig<
  TLane extends IEventLaneDefinition = IEventLaneDefinition,
> = IEventLaneTopologyProfile<TLane>;
export type EventLanesMode = RemoteLanesMode;

export type EventLanesTopology<
  TBindings extends readonly EventLaneBinding[] = readonly EventLaneBinding[],
  TProfiles extends Record<
    string,
    EventLaneProfileConfig<TBindings[number]["lane"]>
  > = Record<string, EventLaneProfileConfig<TBindings[number]["lane"]>>,
> = IEventLaneTopology<TBindings, TProfiles>;

export type EventLanesProfileId<TTopology extends EventLanesTopology> = Extract<
  keyof TTopology["profiles"],
  string
>;

export interface EventLanesResourceConfig<
  TTopology extends EventLanesTopology = EventLanesTopology,
  TProfile extends EventLanesProfileId<TTopology> =
    EventLanesProfileId<TTopology>,
> {
  profile: TProfile;
  topology: TTopology;
  mode?: EventLanesMode;
}

export type EventLanesResourceWithConfig<
  TTopology extends EventLanesTopology = EventLanesTopology,
> = EventLanesResourceConfig<TTopology, EventLanesProfileId<TTopology>>;
