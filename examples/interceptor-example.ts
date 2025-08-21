/**
 * Example demonstrating EventManager interceptors
 * Shows how to use interceptEmission and interceptHook
 */

import { event, hook, resource, run } from "../src";
import { EventManager } from "../src/models/EventManager";

// Define an event
const userActionEvent = event<{ action: string; userId: string }>({
  id: "userAction",
  meta: { title: "User Action Event" },
});

// Define a hook that listens to the event
const userActionHook = hook({
  id: "userActionLogger",
  on: userActionEvent,
  run: async (event: any) => {
    console.log(
      `User ${event.data.userId} performed action: ${event.data.action}`,
    );
  },
});

// Create a simple app
const app = resource({
  id: "interceptor-example-app",
  register: [userActionEvent, userActionHook],
  init: async () => {
    console.log("App initialized");

    // Get the EventManager instance from the context
    // Note: In a real app, you would get this from the dependency injection context
    // For this example, we'll demonstrate the API directly
  },
});

// Example usage
async function demonstrateInterceptors() {
  console.log("=== EventManager Interceptor Example ===\n");

  // Get the event manager (in real usage, this would come from DI)
  const eventManager = new EventManager();

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

  console.log(
    "\n4. Emitting event (this will trigger interceptors and listeners):",
  );
  await eventManager.emit(
    userActionEvent,
    {
      action: "button_click",
      userId: "user123",
    },
    "example-source",
  );

  console.log("\n5. Executing hook with interceptors:");
  const mockEvent = {
    id: "userAction",
    data: { action: "form_submit", userId: "user456" },
    timestamp: new Date(),
    source: "example-source",
    meta: {},
    tags: [],
    stopPropagation: () => {},
    isPropagationStopped: () => false,
  };

  await eventManager.executeHookWithInterceptors(userActionHook, mockEvent, {});

  console.log("\n=== Example completed ===");
}

// Run the example
if (require.main === module) {
  demonstrateInterceptors().catch(console.error);
}

export { demonstrateInterceptors };
