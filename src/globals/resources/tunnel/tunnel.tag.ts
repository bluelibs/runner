import { defineTag } from "../../../define";
import type { TunnelRunner } from "./types";

// Marks a resource as a tunnel and enforces its value to satisfy TunnelRunner.
export const tunnelTag = defineTag<void, void, TunnelRunner>({
  id: "globals.tags.tunnel",
  meta: {
    title: "Tunnel",
    description:
      "Marks a resource that exposes a runner to tunnel selected tasks (override task run() with resource.run(taskId, input)).",
  },
});
