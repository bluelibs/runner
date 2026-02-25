import type { IEventLaneMeta } from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import { defineEventLane } from "../../defineEventLane";
import type { EventLaneFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { clone } from "./utils";

export function makeEventLaneBuilder<TMeta extends IEventLaneMeta>(
  state: BuilderState<TMeta>,
): EventLaneFluentBuilder<TMeta> {
  const builder: EventLaneFluentBuilder<TMeta> = {
    id: state.id,

    title(value: string) {
      type TNextMeta = TMeta & { title: string };
      const next = clone(state as BuilderState<TNextMeta>, {
        meta: {
          ...(state.meta as IEventLaneMeta),
          title: value,
        } as TNextMeta,
      });
      return makeEventLaneBuilder(next);
    },

    description(value: string) {
      type TNextMeta = TMeta & { description: string };
      const next = clone(state as BuilderState<TNextMeta>, {
        meta: {
          ...(state.meta as IEventLaneMeta),
          description: value,
        } as TNextMeta,
      });
      return makeEventLaneBuilder(next);
    },

    meta<TNewMeta extends IEventLaneMeta>(meta: TNewMeta) {
      const next = clone(state as BuilderState<TNewMeta>, { meta });
      return makeEventLaneBuilder(next);
    },

    build() {
      const lane = defineEventLane({
        id: state.id,
        meta: state.meta,
      });
      return deepFreeze({
        ...lane,
        [symbolFilePath]: state.filePath,
      });
    },
  };

  return builder;
}
