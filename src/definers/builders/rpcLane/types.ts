import type { IRpcLaneDefinition } from "../../../defs";

export type BuilderState<TMeta> = Readonly<
  Required<Pick<IRpcLaneDefinition, "id">> &
    Pick<IRpcLaneDefinition, "meta" | "client" | "applyTo"> & {
      filePath: string;
      _metaType?: TMeta;
    }
>;
