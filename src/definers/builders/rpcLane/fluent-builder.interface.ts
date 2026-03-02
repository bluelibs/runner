import type {
  IEventDefinition,
  IRpcLanePolicy,
  IRpcLane,
  IRpcLaneDefinition,
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
  policy(policy: IRpcLanePolicy): RpcLaneFluentBuilder<_TMeta>;
  applyTo(
    targets:
      | readonly (ITaskDefinition<any> | IEventDefinition<any> | string)[]
      | ((target: ITaskDefinition<any> | IEventDefinition<any>) => boolean),
  ): RpcLaneFluentBuilder<_TMeta>;
  asyncContexts(
    contexts: NonNullable<IRpcLaneDefinition["asyncContexts"]>,
  ): RpcLaneFluentBuilder<_TMeta>;
  meta<TNewMeta extends IRpcLaneMeta>(
    meta: TNewMeta,
  ): RpcLaneFluentBuilder<TNewMeta>;
  build(): IRpcLane;
}
