import { defineResource } from "../../definers/defineResource";
import type { MiddlewareManager } from "../../models/MiddlewareManager";
import { globalTags } from "../globalTags";

export const middlewareManagerResource = defineResource<
  void,
  Promise<MiddlewareManager>
>({
  id: "middlewareManager",
  meta: {
    title: "Middleware Manager",
    description: "Manages all middleware and middleware interceptors.",
  },
  tags: [globalTags.system],
});
