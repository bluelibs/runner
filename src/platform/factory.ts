import type { IPlatformAdapter } from "./types";
import { NodePlatformAdapter } from "./adapters/node";
import { BrowserPlatformAdapter } from "./adapters/browser";
import { EdgePlatformAdapter } from "./adapters/edge";
import { UniversalPlatformAdapter } from "./adapters/universal";

declare const __TARGET__: string | undefined;

export function createPlatformAdapter(): IPlatformAdapter {
  if (typeof __TARGET__ !== "undefined") {
    switch (__TARGET__) {
      case "node":
        return new NodePlatformAdapter();
      case "browser":
        return new BrowserPlatformAdapter();
      case "edge":
        return new EdgePlatformAdapter();
    }
  }
  return new UniversalPlatformAdapter();
}
