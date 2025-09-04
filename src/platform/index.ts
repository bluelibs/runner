/**
 * Platform detection and factory
 * Automatically detects the runtime environment and returns the appropriate adapter
 */
import { NodePlatformAdapter } from "./node";
import { BrowserPlatformAdapter } from "./browser";
import { UniversalPlatformAdapter } from "./universal";
import type { IPlatformAdapter } from "./types";

let platformInstance: IPlatformAdapter | null = null;

export function getPlatform(): IPlatformAdapter {
  if (platformInstance) {
    return platformInstance;
  }

  // Detect Node.js environment
  if (typeof process !== "undefined" && process.versions?.node) {
    platformInstance = new NodePlatformAdapter();
  } else if (
    typeof window !== "undefined" || typeof document !== "undefined"
  ) {
    // Browser main thread (or environments exposing window/document)
    platformInstance = new BrowserPlatformAdapter();
  } else {
    // Universal environment (browser, web workers, edge runtimes, etc.)
    platformInstance = new UniversalPlatformAdapter();
  }

  return platformInstance;
}

// Allow manual override for testing or special cases
export function setPlatform(adapter: IPlatformAdapter): void {
  platformInstance = adapter;
}

// Reset to auto-detection
export function resetPlatform(): void {
  platformInstance = null;
}

// Re-export types and adapters for advanced use cases
export type { IPlatformAdapter, IAsyncLocalStorage } from "./types";
export { NodePlatformAdapter } from "./node";
export { BrowserPlatformAdapter } from "./browser";
export { UniversalPlatformAdapter } from "./universal";
