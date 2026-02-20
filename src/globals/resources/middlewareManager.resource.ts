import { defineResource } from "../../define";
import type { MiddlewareManager } from "../../models/MiddlewareManager";
import { globalTags } from "../globalTags";

export const middlewareManagerResource = defineResource<
  void,
  Promise<MiddlewareManager>
>({
  id: "globals.resources.middlewareManager",
  meta: {
    title: "Middleware Manager",
    description: "Manages all middleware and middleware interceptors.",
  },
  tags: [globalTags.system],
});
