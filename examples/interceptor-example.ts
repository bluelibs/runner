/**
 * Example demonstrating EventManager interceptors.
 * Shows how to use intercept and interceptHook through the runtime DI instance.
 */

import { r, resources, run } from "@bluelibs/runner";

// Define an event
const userActionEvent = r
  .event<{ action: string; userId: string }>("userAction")
  .meta({ title: "User Action Event" })
  .build();

// Define a hook that listens to the event
const userActionHook = r
  .hook("userActionLogger")
  .on(userActionEvent)
  .run(async (event: any) => {
    console.log(
      `User ${event.data.userId} performed action: ${event.data.action}`,
    );
  })
  .build();

// Create a simple app
const app = r
  .resource("interceptor-example-app")
  .register([userActionEvent, userActionHook])
  .dependencies({ eventManager: resources.eventManager })
  .init(async (_, { eventManager }) => {
    console.log("App initialized");
    console.log("1. Adding emission interceptors:");

    eventManager.intercept(async (next, event) => {
      console.log(`[Interceptor 1] Event about to be emitted: ${event.id}`);
      const result = await next(event);
      console.log(`[Interceptor 1] Event emission completed: ${event.id}`);
      return result;
    });

    eventManager.intercept(async (next, event) => {
      console.log(`[Interceptor 2] Event about to be emitted: ${event.id}`);
      const result = await next(event);
      console.log(`[Interceptor 2] Event emission completed: ${event.id}`);
      return result;
    });

    console.log("\n2. Adding hook interceptors:");
    eventManager.interceptHook(async (next, hook, event) => {
      console.log(`[Hook Interceptor 1] Hook about to execute: ${hook.id}`);
      const result = await next(hook, event);
      console.log(`[Hook Interceptor 1] Hook execution completed: ${hook.id}`);
      return result;
    });

    eventManager.interceptHook(async (next, hook, event) => {
      console.log(`[Hook Interceptor 2] Hook about to execute: ${hook.id}`);
      const result = await next(hook, event);
      console.log(`[Hook Interceptor 2] Hook execution completed: ${hook.id}`);
      return result;
    });

    console.log("\n3. Adding event listeners:");
    eventManager.addListener(userActionEvent, (event: any) => {
      console.log(
        `[Listener] Received event: ${event.data.userId} -> ${event.data.action}`,
      );
    });
  })
  .build();

// Example usage
async function demonstrateInterceptors() {
  console.log("=== EventManager Interceptor Example ===\n");
  const runtime = await run(app);

  console.log(
    "\n4. Emitting event (this will trigger interceptors and listeners):",
  );
  await runtime.emitEvent(userActionEvent, {
    action: "button_click",
    userId: "user123",
  });

  console.log("\n=== Example completed ===");
  await runtime.dispose();
}

// Run the example
if (require.main === module) {
  demonstrateInterceptors().catch(console.error);
}

export { demonstrateInterceptors };
