import * as http from "http";
import { z } from "zod";
import { defineResource } from "../../../../define";
import { defineTask } from "../../../../definers/defineTask";
import { defineEvent } from "../../../../definers/defineEvent";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";

export const TOKEN = "unit-secret";

export const testTask = defineTask<{ v: number }, Promise<number>>({
  id: "unit.exposure.task",
  inputSchema: z.object({ v: z.number() }).strict(),
  resultSchema: z.number(),
  run: async ({ v }) => v,
});

export const testEvent = defineEvent<{ msg?: string }>({
  id: "unit.exposure.event",
});

export const noInputTask = defineTask<void, Promise<number>>({
  id: "unit.exposure.noInputTask",
  run: async () => 1,
});

export async function startExposureServer() {
  const exposure = nodeExposure.with({
    http: {
      dangerouslyAllowOpenExposure: true,
      basePath: "/__runner",
      listen: { port: 0 },
      auth: { token: TOKEN },
    },
  });
  const app = defineResource({
    id: "unit.exposure.app",
    register: [testTask, noInputTask, testEvent, exposure],
  });
  const rr = await run(app);
  const handlers = await rr.getResourceValue(exposure.resource as any);
  const addr = handlers.server?.address();
  if (!addr || typeof addr === "string") throw new Error("No server address");
  const baseUrl = `http://127.0.0.1:${addr.port}${handlers.basePath}`;
  return { rr, handlers, baseUrl } as const;
}

export function request({
  method,
  url,
  headers,
  body,
}: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) =>
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
        );
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks as readonly Uint8Array[]).toString(
              "utf8",
            ),
          }),
        );
      },
    );
    req.on("error", reject);
    if (body != null) req.end(body);
    else req.end();
  });
}
