import { defineResource } from "../../define";
import { globalTags } from "../globalTags";
import type { RunResult } from "../../models/RunResult";

const systemTag = globalTags.system;
const containerInternalsTag = globalTags.containerInternals;

export const runtimeResource = defineResource<
  void,
  Promise<RunResult<unknown>>
>({
  id: "globals.resources.runtime",
  meta: {
    title: "Runtime Services",
    description:
      "Safe runtime facade for advanced in-resource operations (task/event execution, resource reads, root helpers).",
  },
  tags: [systemTag, containerInternalsTag],
});
