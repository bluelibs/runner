import { defineTag } from "../../../definers/defineTag";
import type { DurableResource } from "../core/DurableResource";

/**
 * Marks Runner resources that host a local durable runtime instance.
 *
 * The tag exists so framework hooks can discover durable runtimes through the
 * normal tag index instead of scanning resource values ad hoc.
 */
export const durableRuntimeTag = defineTag<
  void,
  void,
  DurableResource,
  "resources"
>({
  id: "durableRuntime",
  targets: ["resources"] as const,
  meta: {
    title: "Durable Runtime",
    description:
      "Marks resources that host a durable workflow runtime instance.",
  },
});
