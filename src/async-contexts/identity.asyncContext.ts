import {
  identityContextRequiredError,
  identityInvalidContextError,
} from "../errors";
import { defineAsyncContext } from "../definers/defineAsyncContext";
import { getPlatform } from "../platform";
import type { IdentityContextValue } from "../public-types";
import { Match } from "../tools/check";
import { freezeIfLineageLocked } from "../tools/deepFreeze";
import type { IAsyncContext } from "../types/asyncContext";
import {
  symbolAsyncContext,
  symbolFilePath,
  symbolOptionalDependency,
} from "../types/symbols";

export const IDENTITY_ASYNC_CONTEXT_ID = "identity";
export const GLOBAL_IDENTITY_NAMESPACE = "__global__";
export const IDENTITY_SCOPE_SEPARATOR = ":";

export const identityContextValuePattern = Match.ObjectIncluding({
  tenantId: Match.Optional(Match.NonEmptyString),
  userId: Match.Optional(Match.NonEmptyString),
});

const baseIdentityAsyncContext = defineAsyncContext<IdentityContextValue>({
  id: IDENTITY_ASYNC_CONTEXT_ID,
  configSchema: identityContextValuePattern,
});

export function validateBuiltInIdentityContextValue(
  value: unknown,
): IdentityContextValue {
  if (!Match.test(value, identityContextValuePattern)) {
    throw identityInvalidContextError.new({});
  }

  const identity = value as unknown as IdentityContextValue;

  if (identity.tenantId === GLOBAL_IDENTITY_NAMESPACE) {
    throw identityInvalidContextError.new({
      reason: `Identity "tenantId" cannot be "${GLOBAL_IDENTITY_NAMESPACE}" because that value is reserved for the shared non-identity namespace.`,
    });
  }

  if (
    identity.tenantId?.includes(IDENTITY_SCOPE_SEPARATOR) ||
    identity.userId?.includes(IDENTITY_SCOPE_SEPARATOR)
  ) {
    throw identityInvalidContextError.new({
      reason: `Identity fields cannot contain "${IDENTITY_SCOPE_SEPARATOR}" because identity-scoped middleware keys use it as a separator.`,
    });
  }

  return identity;
}

const tryUse = (): IdentityContextValue | undefined => {
  if (!getPlatform().hasAsyncLocalStorage()) {
    return undefined;
  }

  const current = baseIdentityAsyncContext.tryUse();
  if (current === undefined) {
    return undefined;
  }

  return validateBuiltInIdentityContextValue(current);
};

const use = (): IdentityContextValue => {
  const current = tryUse();
  if (current !== undefined) {
    return current;
  }

  throw identityContextRequiredError.new({});
};

const identityAsyncContextDefinition = {
  id: IDENTITY_ASYNC_CONTEXT_ID,
  [symbolAsyncContext]: true as const,
  [symbolFilePath]: baseIdentityAsyncContext[symbolFilePath],
  configSchema: baseIdentityAsyncContext.configSchema,
  serialize: baseIdentityAsyncContext.serialize,
  parse: baseIdentityAsyncContext.parse,
  use,
  tryUse,
  has() {
    if (!getPlatform().hasAsyncLocalStorage()) {
      return false;
    }

    return baseIdentityAsyncContext.has();
  },
  provide<R>(value: IdentityContextValue, fn: () => Promise<R> | R) {
    if (!getPlatform().hasAsyncLocalStorage()) {
      return fn();
    }

    return baseIdentityAsyncContext.provide(
      validateBuiltInIdentityContextValue(value),
      fn,
    );
  },
  require() {
    return baseIdentityAsyncContext.require();
  },
  optional() {
    return freezeIfLineageLocked(identityAsyncContext, {
      inner: identityAsyncContext,
      [symbolOptionalDependency]: true as const,
    });
  },
};

export const identityAsyncContext = Object.freeze(
  identityAsyncContextDefinition,
) as unknown as IAsyncContext<IdentityContextValue>;
