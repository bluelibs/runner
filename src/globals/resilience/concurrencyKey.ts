import { GLOBAL_IDENTITY_NAMESPACE } from "../../async-contexts/identity.constants";

/** Direct semaphore handles and keyed middleware must address the same Redis pool. */
export function sharedConcurrencyKey(
  key: string,
  identityNamespace = GLOBAL_IDENTITY_NAMESPACE,
): string {
  return JSON.stringify(["shared", key, identityNamespace]);
}
