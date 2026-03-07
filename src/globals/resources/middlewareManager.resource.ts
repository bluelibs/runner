import { defineFrameworkResource } from "../../definers/frameworkDefinition";
import type { MiddlewareManager } from "../../models/MiddlewareManager";
import { globalTags } from "../globalTags";

export const middlewareManagerResource = defineFrameworkResource<
  void,
  Promise<MiddlewareManager>
>({
  id: "system.middlewareManager",
  meta: {
    title: "Middleware Manager",
    description: "Manages all middleware and middleware interceptors.",
  },
  tags: [globalTags.system],
});
