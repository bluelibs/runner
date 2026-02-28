import type { IRpcLaneDefinition } from "../../../defs";

export type BuilderState<TMeta> = Readonly<
  Required<Pick<IRpcLaneDefinition, "id">> &
    Pick<IRpcLaneDefinition, "meta" | "applyTo" | "asyncContexts"> & {
      filePath: string;
      _metaType?: TMeta;
    }
>;
