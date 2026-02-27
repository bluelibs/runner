import type {
  IEventDefinition,
  IRpcLane,
  IRpcLaneMeta,
  ITaskDefinition,
} from "../../../defs";

export interface RpcLaneFluentBuilder<
  _TMeta extends IRpcLaneMeta = IRpcLaneMeta,
> {
  id: string;
  title(title: string): RpcLaneFluentBuilder<_TMeta & { title: string }>;
  description(
    description: string,
  ): RpcLaneFluentBuilder<_TMeta & { description: string }>;
  applyTo(
    targets: readonly (ITaskDefinition<any> | IEventDefinition<any> | string)[],
  ): RpcLaneFluentBuilder<_TMeta>;
  meta<TNewMeta extends IRpcLaneMeta>(
    meta: TNewMeta,
  ): RpcLaneFluentBuilder<TNewMeta>;
  build(): IRpcLane;
}
