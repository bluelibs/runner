import { Readable } from "stream";
import * as http from "http";

export function createSlowReadable(text: string, delayMs: number): Readable {
  let i = 0;
  return new Readable({
    read() {
      if (i >= text.length) return this.push(null);
      const ch = text[i++];
      setTimeout(() => this.push(Buffer.from(ch, "utf8")), delayMs);
    },
  });
}

export async function getExposureBaseUrl(handlers: {
  server?: import("http").Server | null;
  basePath: string;
}): Promise<string> {
  const addr = handlers.server?.address();
  if (!addr || typeof addr === "string") throw new Error("No server address");
  const origin = `http://127.0.0.1:${addr.port}`;
  return `${origin}${handlers.basePath}`.replace(/\/$/, "");
}

export function createStreamingClient(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  return {
    async task(
      taskId: string,
      body: Readable,
      headers: Record<string, string> = {},
    ) {
      const url = new URL(`${base}/task/${encodeURIComponent(taskId)}`);
      return new Promise<Readable>((resolve, reject) => {
        const req = http.request(
          {
            method: "POST",
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: { "content-type": "application/octet-stream", ...headers },
          },
          (res) => {
            // Return response stream directly for the caller to consume
            resolve(res);
          },
        );
        req.on("error", reject);
        body.on("error", (e) => req.destroy(e));
        body.pipe(req);
      });
    },
  } as const;
}
