import { defineTag } from "../../../define";
import type { TunnelTagConfig } from "./types";

// Tag carries config only; does not enforce output contract to support
// both wrapper resources and direct runner resources.
export const tunnelTag = defineTag<TunnelTagConfig>({
  id: "globals.tags.tunnel",
  meta: {
    title: "Tunnel",
    description:
      "Marks a resource that exposes a runner to tunnel selected tasks (override task run() with resource.run(taskId, input)).",
  },
});
