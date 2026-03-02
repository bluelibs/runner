import { defineTag } from "../../../define";
import type { ITaskMiddleware } from "../../../defs";
import { Match } from "../../../tools/check";

export type TunnelPolicySide = "client" | "server";

/**
 * Identifier-like shape for task middleware references in tunnel policies.
 *
 * Why: tunnel policy config is often authored as plain JSON-ish data, so we
 * support both string ids and `{ id }` objects. Real middleware definitions are
 * also accepted because they structurally contain `id: string`.
 */
export type TunnelMiddlewareId =
  | string
  | Pick<ITaskMiddleware<any, any, any, any>, "id">;

export interface TunnelTaskMiddlewareSidePolicy {
  /**
   * Middleware ids/definitions allowed to run on this side when the task is tunneled.
   * If omitted, defaults to allowing none (caller-side middleware is skipped by default).
   */
  middlewareAllowList?: TunnelMiddlewareId[];
}

export type TunnelTaskMiddlewarePolicySideConfig =
  | TunnelTaskMiddlewareSidePolicy
  | TunnelMiddlewareId[];

export interface TunnelTaskMiddlewarePolicyConfig {
  /**
   * Preferred configuration shape: explicit per-side allowlist.
   */
  client?: TunnelTaskMiddlewarePolicySideConfig;
  server?: TunnelTaskMiddlewarePolicySideConfig;

  /**
   * Backwards-compatible configuration shape (previous): grouped allowlists.
   */
  middlewareAllowList?: {
    client?: TunnelMiddlewareId[];
    server?: TunnelMiddlewareId[];
  };
}

const tunnelMiddlewareIdPattern = Match.OneOf(
  String,
  Match.ObjectIncluding({
    id: String,
  }),
);

const tunnelTaskMiddlewarePolicySidePattern = Match.ObjectIncluding({
  middlewareAllowList: Match.Optional([tunnelMiddlewareIdPattern]),
});

const tunnelTaskMiddlewarePolicySideConfigPattern = Match.OneOf(
  tunnelTaskMiddlewarePolicySidePattern,
  [tunnelMiddlewareIdPattern],
);

const tunnelTaskMiddlewarePolicyConfigPattern = Match.ObjectIncluding({
  client: Match.Optional(tunnelTaskMiddlewarePolicySideConfigPattern),
  server: Match.Optional(tunnelTaskMiddlewarePolicySideConfigPattern),
  middlewareAllowList: Match.Optional(
    Match.ObjectIncluding({
      client: Match.Optional([tunnelMiddlewareIdPattern]),
      server: Match.Optional([tunnelMiddlewareIdPattern]),
    }),
  ),
});

export const tunnelTaskPolicyTag = defineTag<TunnelTaskMiddlewarePolicyConfig>({
  id: "globals.tags.tunnel.middlewarePolicy",
  configSchema: tunnelTaskMiddlewarePolicyConfigPattern,
  meta: {
    title: "Tunnel Middleware Policy",
    description:
      "Controls which middlewares run on caller vs executor when a task is tunneled (whitelist).",
  },
});

/** @deprecated Use tunnelTaskPolicyTag instead. */
export const tunnelPolicyTag = tunnelTaskPolicyTag;
