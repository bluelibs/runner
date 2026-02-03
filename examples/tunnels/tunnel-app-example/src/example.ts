/**
 * Tunnel App Example: Two separate runtimes communicating over real HTTP.
 *
 * - SERVER runtime: owns state and exposes allow-listed tasks via nodeExposure.
 * - CLIENT runtime: uses phantom tasks routed through a tunnel resource.
 */

import { run } from "@bluelibs/runner/node";

import { AuthToken, EnvVar } from "./ids.js";
import type { DemoResult } from "./types.js";
import { assertDefined } from "./assertDefined.js";
import { buildHttpClientApp } from "./client/httpClientApp.js";
import { buildMemoryClientApp } from "./client/memoryClientApp.js";
import { buildServerApp } from "./server/buildServerApp.js";
import { getExposureBaseUrl } from "./server/exposureBaseUrl.js";

enum LogSeparator {
  Line = "============================================================",
}

function resolveAuthToken(): string {
  return process.env[EnvVar.Token] ?? AuthToken.Dev;
}

export async function runTunnelAppExample(): Promise<DemoResult> {
  const authToken = resolveAuthToken();

  console.log(LogSeparator.Line);
  console.log("Starting SERVER runtime...");
  console.log(LogSeparator.Line);

  const { app: serverApp, serverExposure } = buildServerApp({ authToken });
  const serverRuntime = await run(serverApp);

  const exposureHandlers = serverRuntime.getResourceValue(
    serverExposure.resource,
  );
  const baseUrl = getExposureBaseUrl(exposureHandlers);
  console.log(`Server listening at: ${baseUrl}\n`);

  console.log(LogSeparator.Line);
  console.log("Starting CLIENT runtime...");
  console.log(LogSeparator.Line);

  const { app: clientApp, demoTask } = buildHttpClientApp({
    baseUrl,
    authToken,
  });
  const clientRuntime = await run(clientApp);

  try {
    const maybeResult = await clientRuntime.runTask(demoTask);
    const result = assertDefined(maybeResult);

    console.log("\n" + LogSeparator.Line);
    console.log("Demo completed successfully!");
    console.log(LogSeparator.Line);
    console.log(`Notes created on server: ${result.notes.length}`);
    console.log(`Audit entries on server: ${result.audits.length}`);

    return result;
  } finally {
    await clientRuntime.dispose();
    await serverRuntime.dispose();
  }
}

export async function runTunnelAppExampleInMemory(): Promise<DemoResult> {
  const { app, demoTask } = buildMemoryClientApp();
  const runtime = await run(app);
  try {
    return assertDefined(await runtime.runTask(demoTask));
  } finally {
    await runtime.dispose();
  }
}

export {
  buildServerApp,
  buildHttpClientApp,
  buildMemoryClientApp,
  getExposureBaseUrl,
};
