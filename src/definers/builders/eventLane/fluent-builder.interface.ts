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
  title(title: string): EventLaneFluentBuilder<_TMeta & { title: string }>;
  description(
    description: string,
  ): EventLaneFluentBuilder<_TMeta & { description: string }>;
  applyTo(
    targets:
      | readonly (IEventDefinition<any> | string)[]
      | ((event: IEventDefinition<any>) => boolean),
  ): EventLaneFluentBuilder<_TMeta>;
  asyncContexts(
    contexts: NonNullable<IEventLaneDefinition["asyncContexts"]>,
  ): EventLaneFluentBuilder<_TMeta>;
  meta<TNewMeta extends IEventLaneMeta>(
    meta: TNewMeta,
  ): EventLaneFluentBuilder<TNewMeta>;
  build(): IEventLane;
}
