import type { IRpcLaneDefinition } from "../../../defs";

export type BuilderState<TMeta> = Readonly<
  Required<Pick<IRpcLaneDefinition, "id">> &
    Pick<
      IRpcLaneDefinition,
      "meta" | "policy" | "applyTo" | "asyncContexts"
    > & {
      filePath: string;
      _metaType?: TMeta;
    }
>;
