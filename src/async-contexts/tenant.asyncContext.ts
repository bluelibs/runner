import {
  tenantContextRequiredError,
  tenantInvalidContextError,
} from "../errors";
import { defineAsyncContext } from "../definers/defineAsyncContext";
import { requireContextTaskMiddleware } from "../globals/middleware/requireContext.middleware";
import { getPlatform } from "../platform";
import type { TenantContextValue } from "../public-types";
import { Match } from "../tools/check";
import type { IAsyncContext } from "../types/asyncContext";

export const TENANT_ASYNC_CONTEXT_ID = "tenant";

export const tenantContextValuePattern = Match.ObjectIncluding({
  tenantId: Match.NonEmptyString,
});

type TenantAsyncContextAccessor = Omit<
  Pick<
    IAsyncContext<TenantContextValue>,
    "id" | "use" | "tryUse" | "has" | "provide" | "require"
  >,
  "require"
> & {
  require(): ReturnType<typeof requireContextTaskMiddleware.with>;
};

let sharedTenantAsyncContext:
  | IAsyncContext<TenantContextValue>
  | null
  | undefined;
let sharedTenantAsyncContextPlatform:
  | ReturnType<typeof getPlatform>
  | undefined;

function getTenantAsyncContext(): IAsyncContext<TenantContextValue> | null {
  const platform = getPlatform();
  if (sharedTenantAsyncContextPlatform !== platform) {
    sharedTenantAsyncContextPlatform = platform;
    sharedTenantAsyncContext = platform.hasAsyncLocalStorage()
      ? defineAsyncContext<TenantContextValue>({
          id: TENANT_ASYNC_CONTEXT_ID,
        })
      : null;
  }

  return sharedTenantAsyncContext ?? null;
}

export function validateTenantContextValue(value: unknown): TenantContextValue {
  if (!Match.test(value, tenantContextValuePattern)) {
    throw tenantInvalidContextError.new({});
  }

  // App-level TenantContextValue augmentation may require fields that Runner
  // cannot validate generically. At this boundary we only guarantee the
  // built-in tenant contract and preserve any extra fields that came in.
  return value as unknown as TenantContextValue;
}

function tryUse(): TenantContextValue | undefined {
  const context = getTenantAsyncContext();
  if (!context) {
    return undefined;
  }

  const current = context.tryUse();
  if (current === undefined) {
    return undefined;
  }

  return validateTenantContextValue(current);
}

function use(): TenantContextValue {
  const current = tryUse();
  if (current !== undefined) {
    return current;
  }

  throw tenantContextRequiredError.new({});
}

export const tenantAsyncContext: TenantAsyncContextAccessor = Object.freeze({
  id: TENANT_ASYNC_CONTEXT_ID,
  use,
  tryUse,
  has() {
    return getTenantAsyncContext()?.has() ?? false;
  },
  provide<R>(
    value: TenantContextValue,
    fn: () => Promise<R> | R,
  ): Promise<R> | R {
    const validated = validateTenantContextValue(value);
    const context = getTenantAsyncContext();
    if (!context) {
      return fn();
    }

    return context.provide(validated, fn);
  },
  require(): ReturnType<typeof requireContextTaskMiddleware.with> {
    return requireContextTaskMiddleware.with({
      context: tenantAsyncContext,
    });
  },
});
