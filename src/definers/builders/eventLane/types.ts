import type { IEventLaneDefinition } from "../../../defs";

export type BuilderState<TMeta> = Readonly<
  Required<Pick<IEventLaneDefinition, "id">> &
    Pick<IEventLaneDefinition, "meta"> & {
      filePath: string;
      _metaType?: TMeta;
    }
>;
