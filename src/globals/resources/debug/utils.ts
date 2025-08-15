import { ITaggable } from "../../../defs";
import { globalTags } from "../../globalTags";
export const safeStringify = (value: any) => {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
};

export const hasSystemOrLifecycleTag = (definition: ITaggable) => {
  return Boolean(
    globalTags.system.extract(definition) ||
      globalTags.lifecycle.extract(definition)
  );
};
