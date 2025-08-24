import { ITaggable } from "../../../defs";
import { globalTags } from "../../globalTags";

export const hasSystemTag = (definition: ITaggable) => {
  const maybeTags = definition.tags;
  if (!Array.isArray(maybeTags)) {
    return false;
  }
  return globalTags.system.exists(definition);
};
