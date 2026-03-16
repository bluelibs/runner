type SymbolWithMetadata = typeof Symbol & {
  metadata?: symbol;
};

/**
 * Ensures standard decorator metadata has a stable symbol on runtimes that do
 * not expose one yet, while preserving native implementations.
 */
export function ensureSymbolMetadata(): void {
  if ((Symbol as SymbolWithMetadata).metadata !== undefined) {
    return;
  }

  Object.defineProperty(Symbol, "metadata", {
    value: Symbol("Symbol.metadata"),
    configurable: true,
    writable: true,
  });
}
