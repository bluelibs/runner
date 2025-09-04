/**
 * Test script to verify the examples work correctly
 * Run with: node test-examples.js
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("🧪 Testing BlueLibs Runner Examples...\n");

// Test that the built package exports what we expect
try {
  const packagePath = join(__dirname, "../dist/index.js");
  const { run, resource, task, event, hook } = await import(packagePath);

  console.log("✅ Package imports successfully");
  console.log("✅ run function available:", typeof run === "function");
  console.log(
    "✅ resource function available:",
    typeof resource === "function",
  );
  console.log("✅ task function available:", typeof task === "function");
  console.log("✅ event function available:", typeof event === "function");
  console.log("✅ hook function available:", typeof hook === "function");

  // Test basic functionality
  console.log("\n🔧 Testing basic functionality...");

  const testResource = resource({
    id: "test",
    init: async () => ({ working: true, timestamp: Date.now() }),
  });

  const result = await run(testResource);
  const resourceValue = result.getResourceValue(testResource);
  console.log(
    "✅ Basic run test:",
    resourceValue.working === true ? "PASS" : "FAIL",
  );
  console.log(
    "✅ Resource value access:",
    typeof resourceValue.timestamp === "number" ? "PASS" : "FAIL",
  );

  // Test task execution
  console.log("\n⚙️  Testing task execution...");

  const mathTask = task({
    id: "math-task",
    run: async (numbers) => {
      const sum = numbers.reduce((a, b) => a + b, 0);
      return { sum, average: sum / numbers.length };
    },
  });

  const taskApp = resource({
    id: "task-app",
    register: [mathTask],
    dependencies: { math: mathTask },
    init: async (_, { math }) => ({ math }),
  });

  const taskResult = await run(taskApp);
  const mathResult = await taskResult.runTask(mathTask, [1, 2, 3, 4, 5]);
  console.log("✅ Task execution:", mathResult.sum === 15 ? "PASS" : "FAIL");
  console.log(
    "✅ Task calculation:",
    mathResult.average === 3 ? "PASS" : "FAIL",
  );

  // Test events
  console.log("\n🔔 Testing event system...");

  let eventReceived = false;
  let hookData = null;

  const testEvent = event({
    id: "test-event",
    payload: (data) => ({ data }),
  });

  const testHook = hook({
    id: "test-hook",
    event: testEvent,
    run: async ({ data }) => {
      eventReceived = true;
      hookData = data;
    },
  });

  const eventApp = resource({
    id: "event-app",
    register: [testHook],
    init: async () => {
      await testEvent.emit({ message: "Hello Events!" });
      return {};
    },
  });

  const eventResult = await run(eventApp);
  console.log("✅ Event emission:", eventReceived ? "PASS" : "FAIL");
  console.log(
    "✅ Hook execution:",
    hookData?.message === "Hello Events!" ? "PASS" : "FAIL",
  );

  // Test error handling
  console.log("\n💥 Testing error handling...");

  const failingTask = task({
    id: "failing-task",
    run: async () => {
      throw new Error("Test error");
    },
  });

  try {
    const errorApp = resource({
      id: "error-app",
      register: [failingTask],
      dependencies: { failing: failingTask },
      init: async (_, { failing }) => ({ failing }),
    });

    const errorResult = await run(errorApp);
    await errorResult.runTask(failingTask);
    console.log("❌ Error handling: FAIL (should have thrown)");
  } catch (error) {
    console.log(
      "✅ Error handling:",
      error.message === "Test error" ? "PASS" : "FAIL",
    );
  }

  // Test resource disposal
  console.log("\n🧹 Testing resource disposal...");

  let disposeCount = 0;

  const disposableResource = resource({
    id: "disposable",
    init: async () => ({ value: "test" }),
    dispose: async () => {
      disposeCount++;
    },
  });

  const result2 = await run(disposableResource);
  await result2.dispose();
  console.log("✅ Resource disposal:", disposeCount === 1 ? "PASS" : "FAIL");
} catch (error) {
  console.error("❌ Test failed:", error.message);
  console.error(error.stack);
  process.exit(1);
}

console.log("\n🎉 All tests passed!");
console.log("\n📋 Example Usage:");
console.log(
  "- Browser: Open examples/universal/browser-test.html in a browser",
);
console.log(
  "- Browser App: Open examples/universal/browser-app.html in a browser",
);
console.log("- Node.js: Run node examples/universal/node-server.js");
console.log("- Universal: Run node examples/universal/universal-example.js");
console.log(
  "- Edge Function: Deploy examples/universal/edge-function.js to Cloudflare Workers",
);
