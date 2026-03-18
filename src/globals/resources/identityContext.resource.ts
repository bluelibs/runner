import type { IdentityContextValue } from "../../public-types";
import type { IdentityAsyncContext } from "../../types/runner";
import type { ValidationSchemaInput } from "../../types/utilities";
import { Match } from "../../tools/check";
import { defineResource } from "../../definers/defineResource";

export interface IdentityContextResourceConfig {
  /**
   * Async context Runner should read for identity-aware framework behavior.
   */
  context: IdentityAsyncContext;
}

export interface IdentityContextResourceValue {
  /**
   * Reads the currently active payload for the configured runtime identity
   * context.
   */
  tryUse(): IdentityContextValue | undefined;
}

function isIdentityContextAccessor(
  value: unknown,
): value is IdentityAsyncContext {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.use === "function" &&
    typeof candidate.tryUse === "function" &&
    typeof candidate.has === "function" &&
    typeof candidate.provide === "function" &&
    typeof candidate.require === "function"
  );
}

const identityContextConfigPattern: ValidationSchemaInput<IdentityContextResourceConfig> =
  Match.ObjectIncluding({
    context: Match.Where((value: unknown): value is IdentityAsyncContext =>
      isIdentityContextAccessor(value),
    ),
  });

export const identityContextResource = defineResource<
  IdentityContextResourceConfig,
  Promise<IdentityContextResourceValue>
>({
  id: "identityContext",
  meta: {
    title: "Identity Context Reader",
    description:
      "Internal runner-owned adapter that exposes the active runtime identity async context to identity-aware framework middleware.",
  },
  configSchema: identityContextConfigPattern,
  init: async (config, _dependencies, _context) => ({
    tryUse() {
      return config.context.tryUse();
    },
  }),
});
