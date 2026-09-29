const identities = new WeakMap<object, string>();

/** Keep composition identity internal; it is stable across replicas with the same graph. */
export function bindMiddlewareApplication<T extends object>(
  execution: T,
  identity: string,
): T {
  identities.set(execution, identity);
  return execution;
}

/** Direct middleware invocations outside the composer retain their task identity. */
export function getMiddlewareApplicationIdentity(
  execution: object,
  taskId: string,
): string {
  return identities.get(execution) ?? taskId;
}
