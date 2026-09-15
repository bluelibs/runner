/**
 * Studio entry point: boots the Runner runtime and serves the HTTP API
 * (plus the built web client when `web/dist` exists).
 */
import type { AddressInfo } from "node:net";
import { createStudioServer } from "./http.js";
import { bootStudio } from "./studioApp.js";

export const DEFAULT_PORT = 4317;

export async function startStudio(port: number = DEFAULT_PORT): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const handles = await bootStudio();
  const token = (process.env.STUDIO_TOKEN ?? "").trim() || undefined;
  const server = createStudioServer(handles, token ? { token } : undefined);
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    // Loopback only: the studio is a local experiment, never a public server.
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const url = `http://localhost:${address.port}`;
  return {
    url,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await handles.dispose();
    },
  };
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const studio = await startStudio(port);
  const locked = (process.env.STUDIO_TOKEN ?? "").trim().length > 0;
  console.log(`\n  Durable Workflows Studio → ${studio.url}${locked ? " (token locked)" : ""}\n`);
}

const isMain = process.argv[1]?.endsWith("index.js") ?? false;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
