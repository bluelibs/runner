import type {
  IEventDefinition,
  IEventLane,
  IEventLaneDefinition,
  IEventLaneMeta,
} from "../../../defs";

export interface EventLaneFluentBuilder<
  _TMeta extends IEventLaneMeta = IEventLaneMeta,
> {
  id: string;
  /** Sets the lane title inside metadata. */
  title(title: string): EventLaneFluentBuilder<_TMeta & { title: string }>;
  /** Sets the lane description inside metadata. */
  description(
    description: string,
  ): EventLaneFluentBuilder<_TMeta & { description: string }>;
  /** Declares which events this lane applies to. */
  applyTo(
    targets:
      | readonly (IEventDefinition<any> | string)[]
      | ((event: IEventDefinition<any>) => boolean),
  ): EventLaneFluentBuilder<_TMeta>;
  /** Declares which async contexts may flow through this lane. */
  asyncContexts(
    contexts: NonNullable<IEventLaneDefinition["asyncContexts"]>,
  ): EventLaneFluentBuilder<_TMeta>;
  /** Replaces the lane metadata object. */
  meta<TNewMeta extends IEventLaneMeta>(
    meta: TNewMeta,
  ): EventLaneFluentBuilder<TNewMeta>;
  /** Materializes the final event-lane definition for registration or reuse. */
  build(): IEventLane;
}
