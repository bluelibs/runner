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
  /** Sets the lane title inside metadata. */
  title(title: string): RpcLaneFluentBuilder<_TMeta & { title: string }>;
  /** Sets the lane description inside metadata. */
  description(
    description: string,
  ): RpcLaneFluentBuilder<_TMeta & { description: string }>;
  /** Declares RPC-lane policy such as middleware allow-listing. */
  policy(policy: IRpcLanePolicy): RpcLaneFluentBuilder<_TMeta>;
  /** Declares which tasks or events this lane applies to. */
  applyTo(
    targets:
      | readonly (ITaskDefinition<any> | IEventDefinition<any> | string)[]
      | ((target: ITaskDefinition<any> | IEventDefinition<any>) => boolean),
  ): RpcLaneFluentBuilder<_TMeta>;
  /** Declares which async contexts may flow through this lane. */
  asyncContexts(
    contexts: NonNullable<IRpcLaneDefinition["asyncContexts"]>,
  ): RpcLaneFluentBuilder<_TMeta>;
  /** Replaces the lane metadata object. */
  meta<TNewMeta extends IRpcLaneMeta>(
    meta: TNewMeta,
  ): RpcLaneFluentBuilder<TNewMeta>;
  /** Materializes the final RPC-lane definition for registration or reuse. */
  build(): IRpcLane;
}
