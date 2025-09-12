import { defineTag } from "../../../define";
import type { TunnelRunner, TunnelTagConfig } from "./types";

// Enforce resource result value contract to expose { run(taskId, input) => Promise<Response> }
export const tunnelTag = defineTag<
  TunnelTagConfig,
  void,
  TunnelRunner
>({
  id: "globals.tags.tunnel",
  meta: {
    title: "Tunnel",
    description:
      "Marks a resource that exposes a runner to tunnel selected tasks (override task run() with resource.run(taskId, input)).",
  },
});

