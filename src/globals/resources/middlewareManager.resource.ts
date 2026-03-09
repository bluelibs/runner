import { defineResource } from "../../definers/defineResource";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import type { MiddlewareManager } from "../../models/MiddlewareManager";
import { globalTags } from "../globalTags";

export const middlewareManagerResource = defineResource<
  void,
  Promise<MiddlewareManager>
>(
  markFrameworkDefinition({
    id: "system.middlewareManager",
    meta: {
      title: "Middleware Manager",
      description: "Manages all middleware and middleware interceptors.",
    },
    tags: [globalTags.system],
  }),
);
