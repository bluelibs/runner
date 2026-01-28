import test from "node:test";
import assert from "node:assert/strict";

import { run } from "@bluelibs/runner/node";

import { AuthToken, EnvVar } from "./ids.js";
import type { DemoResult } from "./types.js";
import { assertDefined } from "./assertDefined.js";
import {
  buildHttpClientApp,
  buildServerApp,
  getExposureBaseUrl,
  runTunnelAppExampleInMemory,
} from "./example.js";

enum TestName {
  InMemory = "tunnel example (memory): phantom tasks are routed",
  OverHttp = "tunnel example (http): tasks execute on remote server",
}

enum ExpectedCount {
  Notes = 2,
  Audits = 2,
}

enum IdPrefix {
  Note = "note-",
  Audit = "audit-",
}

function shouldRunNetworkTests(): boolean {
  return process.env[EnvVar.RunNetTests] === "1";
}

test(TestName.InMemory, async () => {
  const result = await runTunnelAppExampleInMemory();

  assert.strictEqual(result.notes.length, ExpectedCount.Notes);
  assert.strictEqual(result.audits.length, ExpectedCount.Audits);

  assert.ok(result.notes[0].id.startsWith(IdPrefix.Note));
  assert.ok(result.audits[0].id.startsWith(IdPrefix.Audit));
  assert.ok(result.notes[0].createdAt instanceof Date);
  assert.ok(result.audits[0].timestamp instanceof Date);
});

test(TestName.OverHttp, { skip: !shouldRunNetworkTests() }, async () => {
  const authToken = process.env[EnvVar.Token] ?? AuthToken.Dev;

  const { app: serverApp, serverExposure } = buildServerApp({ authToken });
  const serverRuntime = await run(serverApp);

  try {
    const exposureHandlers = serverRuntime.getResourceValue(
      serverExposure.resource,
    );
    const baseUrl = getExposureBaseUrl(exposureHandlers);

    const { app: clientApp, demoTask } = buildHttpClientApp({
      baseUrl,
      authToken,
    });
    const clientRuntime = await run(clientApp);

    try {
      const maybeResult = await clientRuntime.runTask(demoTask);
      const result: DemoResult = assertDefined(maybeResult);

      assert.strictEqual(result.notes.length, ExpectedCount.Notes);
      assert.strictEqual(result.audits.length, ExpectedCount.Audits);

      // Proves ID generation happened on the server
      assert.ok(result.notes[0].id.startsWith(IdPrefix.Note));
      assert.ok(result.audits[0].id.startsWith(IdPrefix.Audit));

      // Proves JSON tunnel serialization round-tripped Dates
      assert.ok(result.notes[0].createdAt instanceof Date);
      assert.ok(result.audits[0].timestamp instanceof Date);
    } finally {
      await clientRuntime.dispose();
    }
  } finally {
    await serverRuntime.dispose();
  }
});
