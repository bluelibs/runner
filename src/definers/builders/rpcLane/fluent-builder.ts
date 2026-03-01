import type { IRpcLaneMeta } from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import { defineRpcLane } from "../../defineRpcLane";
import type { RpcLaneFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { clone } from "./utils";

export function makeRpcLaneBuilder<TMeta extends IRpcLaneMeta>(
  state: BuilderState<TMeta>,
): RpcLaneFluentBuilder<TMeta> {
  const builder: RpcLaneFluentBuilder<TMeta> = {
    id: state.id,

    title(value: string) {
      type TNextMeta = TMeta & { title: string };
      const next = clone(state as BuilderState<TNextMeta>, {
        meta: {
          ...(state.meta as IRpcLaneMeta),
          title: value,
        } as TNextMeta,
      });
      return makeRpcLaneBuilder(next);
    },

    description(value: string) {
      type TNextMeta = TMeta & { description: string };
      const next = clone(state as BuilderState<TNextMeta>, {
        meta: {
          ...(state.meta as IRpcLaneMeta),
          description: value,
        } as TNextMeta,
      });
      return makeRpcLaneBuilder(next);
    },

    applyTo(targets) {
      const next = clone(state, {
        applyTo: typeof targets === "function" ? targets : targets.slice(),
      });
      return makeRpcLaneBuilder(next);
    },

    asyncContexts(contexts) {
      const next = clone(state, {
        asyncContexts: contexts.slice(),
      });
      return makeRpcLaneBuilder(next);
    },

    meta<TNewMeta extends IRpcLaneMeta>(meta: TNewMeta) {
      const next = clone(state as BuilderState<TNewMeta>, { meta });
      return makeRpcLaneBuilder(next);
    },

    build() {
      const lane = defineRpcLane({
        id: state.id,
        meta: state.meta,
        applyTo: state.applyTo,
        asyncContexts: state.asyncContexts,
      });
      return deepFreeze({
        ...lane,
        [symbolFilePath]: state.filePath,
      });
    },
  };

  return builder;
}
