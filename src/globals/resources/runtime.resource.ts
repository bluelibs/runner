import { defineResource } from "../../definers/defineResource";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import { globalTags } from "../globalTags";
import type { RunResult } from "../../models/RunResult";

const systemTag = globalTags.system;

export const runtimeResource = defineResource<
  void,
  Promise<RunResult<unknown>>
>(
  markFrameworkDefinition({
    id: "system.runtime",
    meta: {
      title: "Runtime Services",
      description:
        "Safe runtime facade for advanced in-resource operations (task/event execution, resource reads, root helpers).",
    },
    tags: [systemTag],
  }),
);
