import { defineTag } from "../../../define";
import type { ITaskMiddleware } from "../../../defs";

export type TunnelPolicySide = "client" | "server";

export type TunnelMiddlewareId = string | ITaskMiddleware<any, any, any, any>;

export interface TunnelTaskMiddlewarePolicyConfig {
  /**
   * Whitelist of middleware ids/definitions allowed to run on the caller side
   * when the task is tunneled (mode: "client"). If omitted, defaults to
   * allowing all (the framework default remains "both").
   */
  client?: TunnelMiddlewareId[];
  /**
   * Whitelist of middleware ids/definitions intended to run on the executor side.
   * Note: The local runner cannot enforce server-side policy; this is a declarative
   * contract that a Runner-based executor can consume to apply a symmetric filter.
   */
  server?: TunnelMiddlewareId[];
}

export const tunnelPolicyTag = defineTag<TunnelTaskMiddlewarePolicyConfig>({
  id: "globals.tags.tunnel.middlewarePolicy",
  meta: {
    title: "Tunnel Middleware Policy",
    description:
      "Controls which middlewares run on caller vs executor when a task is tunneled (whitelist).",
  },
});

