import { resource, task, event, run } from "../src/index";

// Simple configuration resource
const config = resource({
  id: "example.config",
  meta: {
    title: "Application Configuration",
    description: "Manages application configuration settings"
  },
  init: async () => ({
    port: 3000,
    environment: "development"
  })
});

// Database resource
const database = resource({
  id: "example.database",
  meta: {
    title: "Database Connection",
    description: "Handles database connections and queries"
  },
  dependencies: { config },
  init: async (_, { config }) => ({
    connection: `Connected to DB on port ${config.port}`,
    query: (sql: string) => `Executing: ${sql}`
  })
});

// User service
const userService = resource({
  id: "example.services.user",
  meta: {
    title: "User Management Service",
    description: "Handles user creation, authentication, and profile management"
  },
  dependencies: { database },
  init: async (_, { database }) => ({
    createUser: async (userData: any) => {
      return { id: Math.random(), ...userData };
    },
    findUser: async (id: string) => {
      return { id, name: "Test User" };
    }
  })
});

// User registered event
const userRegistered = event<{ userId: string; email: string }>({
  id: "example.events.userRegistered",
  meta: {
    title: "User Registered Event",
    description: "Emitted when a new user registers in the system"
  }
});

// Send welcome email task
const sendWelcomeEmail = task({
  id: "example.tasks.sendWelcomeEmail",
  meta: {
    title: "Send Welcome Email",
    description: "Sends a welcome email to newly registered users"
  },
  dependencies: { userService },
  run: async (userData: { email: string; name: string }, { userService }) => {
    console.log(`Sending welcome email to ${userData.email}`);
    return { sent: true, timestamp: new Date().toISOString() };
  }
});

// Process user registration task
const processUserRegistration = task({
  id: "example.tasks.processUserRegistration",
  meta: {
    title: "Process User Registration",
    description: "Handles the complete user registration workflow"
  },
  dependencies: { userService, sendWelcomeEmail },
  run: async (userData: { email: string; name: string }, { userService, sendWelcomeEmail }) => {
    const user = await userService.createUser(userData);
    await sendWelcomeEmail(userData);
    return user;
  }
});

// Root application resource
const app = resource({
  id: "example.app",
  meta: {
    title: "Example Application",
    description: "Main application resource that coordinates all services"
  },
  dependencies: { config, database, userService, processUserRegistration },
  init: async (_, deps) => {
    console.log("Example application initialized");
    return {
      ...deps,
      ready: true
    };
  }
});

// This is just for documentation extraction - we don't actually run the app
if (require.main === module) {
  console.log("Example app loaded for documentation extraction");
}

export { app, config, database, userService, userRegistered, sendWelcomeEmail, processUserRegistration };