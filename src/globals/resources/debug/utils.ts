import { ITaggable } from "../../../defs";
import { globalTags } from "../../globalTags";

export const hasSystemTag = (definition: ITaggable) => {
  return globalTags.system.exists(definition);
};
