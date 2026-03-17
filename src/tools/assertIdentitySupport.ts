import { identityRunOptionRequiresAsyncLocalStorageError } from "../errors";
import { getPlatform } from "../platform";
import { ResolvedRunOptions } from "../types/runner";

export function assertIdentitySupport(
  identity: ResolvedRunOptions["identity"],
): void {
  if (!identity) {
    return;
  }

  if (!getPlatform().hasAsyncLocalStorage()) {
    identityRunOptionRequiresAsyncLocalStorageError.throw({
      contextId: identity.id,
    });
  }
}
