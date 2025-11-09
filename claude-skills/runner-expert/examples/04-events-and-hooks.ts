/**
 * Events and Hooks Example
 *
 * Demonstrates:
 * - Creating typed events
 * - Emitting events from tasks
 * - Creating hooks that listen to events
 * - Hook execution order
 * - stopPropagation()
 */

import { r, run } from "@bluelibs/runner";

// Define an event
const userRegistered = r
  .event("userRegistered")
  .payloadSchema<{ userId: string; email: string; name: string }>({
    parse: (v) => v,
  })
  .build();

// Task that emits the event
const registerUser = r
  .task("registerUser")
  .inputSchema<{ email: string; name: string }>({ parse: (v) => v })
  .dependencies({ userRegistered })
  .run(async (input, { userRegistered }) => {
    console.log(`📝 Registering user: ${input.name}`);

    const user = {
      id: `user-${Date.now()}`,
      email: input.email,
      name: input.name,
    };

    // Emit the event
    await userRegistered({ ...user });

    return user;
  })
  .build();

// Hook 1: Send welcome email (runs first)
const sendWelcomeEmail = r
  .hook("sendWelcomeEmail")
  .on(userRegistered)
  .order(1) // Lower numbers run first
  .run(async (event) => {
    console.log(`📧 Sending welcome email to: ${event.data.email}`);
    // Simulate email sending
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log(`✅ Email sent to ${event.data.name}`);
  })
  .build();

// Hook 2: Create user settings (runs second)
const createUserSettings = r
  .hook("createUserSettings")
  .on(userRegistered)
  .order(2)
  .run(async (event) => {
    console.log(`⚙️  Creating settings for user: ${event.data.userId}`);
    // Simulate settings creation
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log(`✅ Settings created`);
  })
  .build();

// Hook 3: Track analytics (runs third, optional)
const trackRegistration = r
  .hook("trackRegistration")
  .on(userRegistered)
  .order(3)
  .run(async (event) => {
    console.log(`📊 Tracking registration: ${event.data.userId}`);
    // Could call event.stopPropagation() here to prevent further hooks
  })
  .build();

// App
const app = r
  .resource("app")
  .register([
    userRegistered,
    registerUser,
    sendWelcomeEmail,
    createUserSettings,
    trackRegistration,
  ])
  .build();

async function main() {
  const { runTask, dispose } = await run(app);

  console.log("Registering a new user...\n");
  const user = await runTask(registerUser, {
    email: "alice@example.com",
    name: "Alice",
  });

  console.log(`\n✅ User registered:`, user);
  console.log(
    "\nNote: All hooks executed in order (1 → 2 → 3) after the task completed"
  );

  await dispose();
}

if (require.main === module) {
  main().catch(console.error);
}

export { userRegistered, registerUser, sendWelcomeEmail, app };
