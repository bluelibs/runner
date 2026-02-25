import type { IEventLane, IEventLaneMeta } from "../../../defs";

export interface EventLaneFluentBuilder<
  _TMeta extends IEventLaneMeta = IEventLaneMeta,
> {
  id: string;
  title(title: string): EventLaneFluentBuilder<_TMeta & { title: string }>;
  description(
    description: string,
  ): EventLaneFluentBuilder<_TMeta & { description: string }>;
  meta<TNewMeta extends IEventLaneMeta>(
    meta: TNewMeta,
  ): EventLaneFluentBuilder<TNewMeta>;
  build(): IEventLane;
}
