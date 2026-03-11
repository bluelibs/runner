import type { RpcLanesResourceValue } from "@bluelibs/runner/node";
import { Readable } from "stream";

export function createSlowReadable(text: string, delayMs: number): Readable {
  let index = 0;

  return new Readable({
    read() {
      if (index >= text.length) {
        this.push(null);
        return;
      }

      const char = text[index++];
      setTimeout(() => this.push(Buffer.from(char, "utf8")), delayMs);
    },
  });
}

export function getExposureBaseUrl(value: RpcLanesResourceValue): string {
  const handlers = value.exposure?.getHandlers?.();
  if (!handlers) {
    throw new Error("RPC lane exposure handlers are not available.");
  }

  const address = handlers.server?.address();
  if (!address || typeof address === "string") {
    throw new Error("RPC lane server address is not available.");
  }

  return `http://127.0.0.1:${address.port}${handlers.basePath}`.replace(/\/$/, "");
}
