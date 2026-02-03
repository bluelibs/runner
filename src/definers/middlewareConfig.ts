export function mergeMiddlewareConfig<TConfig>(
  base: TConfig,
  next: TConfig,
): TConfig {
  const baseIsPlainObject =
    !!base && typeof base === "object" && !Array.isArray(base);
  const nextIsPlainObject =
    !!next && typeof next === "object" && !Array.isArray(next);

  // Preserve identity for config objects when the base config is empty.
  // This enables patterns like "share resources for the same config object"
  // (eg: concurrency semaphores) without relying on callers to reuse the same
  // configured middleware instance.
  if (
    baseIsPlainObject &&
    nextIsPlainObject &&
    Object.keys(base).length === 0
  ) {
    return next;
  }

  if (baseIsPlainObject && nextIsPlainObject) {
    return {
      ...(base as unknown as Record<string, unknown>),
      ...(next as unknown as Record<string, unknown>),
    } as TConfig;
  }

  return next;
}
