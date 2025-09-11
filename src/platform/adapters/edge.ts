import { BrowserPlatformAdapter } from "./browser";

// Edge runtimes (workers) are closer to browser: no process, no window/document guarantees.
export class EdgePlatformAdapter extends BrowserPlatformAdapter {
  onShutdownSignal(handler: () => void) {
    // No reliable shutdown signal in workers; return no-op disposer
    return () => {};
  }
}
