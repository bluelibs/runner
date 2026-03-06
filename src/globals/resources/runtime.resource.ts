import { defineFrameworkResource } from "../../definers/frameworkDefinition";
import { globalTags } from "../globalTags";
import type { RunResult } from "../../models/RunResult";

const systemTag = globalTags.system;

export const runtimeResource = defineFrameworkResource<
  void,
  Promise<RunResult<unknown>>
>({
  id: "system.runtime",
  meta: {
    title: "Runtime Services",
    description:
      "Safe runtime facade for advanced in-resource operations (task/event execution, resource reads, root helpers).",
  },
  tags: [systemTag],
});
