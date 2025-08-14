import { resource, run, globals } from "@bluelibs/runner";
import { databaseResource } from "./resources/database";
import { userServiceResource } from "./resources/userService";
import {
  expressServerResource,
  ExpressServer,
} from "./resources/expressServer";
import { routeRegistrationListener } from "./tasks/routeRegistration";
import { authMiddleware } from "./middleware/auth";
import {
  registerUserTask,
  loginUserTask,
  getUserProfileTask,
  getAllUsersTask,
} from "./tasks/userTasks";

/**
 * Main application resource that orchestrates all components
 */
const app = resource({
  id: "app.main",
  register: [
    // Core infrastructure
    databaseResource.with({
      filename: "./data.db",
      verbose: true,
    }),
    userServiceResource,
    expressServerResource.with({
      port: 4444,
      cors: true,
      apiPrefix: "/api",
    }),

    // Middleware
    authMiddleware,

    // Route registration
    routeRegistrationListener,

    // User tasks
    registerUserTask,
    loginUserTask,
    getUserProfileTask,
    getAllUsersTask,
  ],
  dependencies: {
    expressServer: expressServerResource,
  },
  init: async (_, { expressServer }: { expressServer: ExpressServer }) => {
    console.log("🎉 Application initialized successfully!");
    console.log(`🌐 Server running on port ${expressServer.port}`);
    console.log(
      `📚 API docs available at http://localhost:${expressServer.port}/api-docs`
    );
    console.log("\n📝 Available endpoints:");
    console.log("  POST /api/auth/register - Register a new user");
    console.log("  POST /api/auth/login - Login user");
    console.log("  GET  /api/auth/profile - Get user profile (requires auth)");
    console.log("  GET  /api/users - Get all users (requires auth)");
    console.log("  GET  /health - Health check");
    console.log("\n💡 Example usage:");
    console.log("  curl -X POST http://localhost:3000/api/auth/register \\");
    console.log('    -H "Content-Type: application/json" \\');
    console.log(
      '    -d \'{"email":"test@example.com","password":"password123","name":"Test User"}\''
    );

    return {
      server: expressServer,
    };
  },
});

/**
 * Start the application
 */
async function startApp() {
  try {
    console.log("🚀 Starting BlueLibs Runner Express Example...");

    const { value: appInstance, dispose } = await run(app);

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("\n📴 Received SIGTERM, shutting down gracefully...");
      await dispose();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log("\n📴 Received SIGINT, shutting down gracefully...");
      await dispose();
      process.exit(0);
    });

    return appInstance;
  } catch (error) {
    console.error("❌ Failed to start application:", error);
    process.exit(1);
  }
}

// Start the app if this file is run directly
if (require.main === module) {
  startApp();
}

export { app, startApp };
