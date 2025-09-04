/**
 * Node.js Server Example
 * Traditional server-side usage with full Node.js features
 */
import { run, resource, task } from "../../dist/index.js";
import express from "express";

const server = resource({
  id: "express-server",
  init: async (config) => {
    const app = express();
    const server = app.listen(config.port);
    console.log(`Server running on port ${config.port}`);
    return { app, server };
  },
  dispose: async ({ server }) => {
    server.close();
    console.log("Server closed");
  },
});

const healthCheck = task({
  id: "health-check",
  dependencies: { server },
  run: async (_, { server }) => {
    server.app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });
    return "Health check endpoint registered";
  },
});

const app = resource({
  id: "app",
  register: [server.with({ port: 3000 }), healthCheck],
  dependencies: { server, healthCheck },
  init: async (_, { server, healthCheck }) => {
    console.log("App initialized:", healthCheck);
    return { server: server.server };
  },
});

// Run with full Node.js features
// - Process signal handling (SIGTERM, SIGINT)
// - Real AsyncLocalStorage for context tracking
// - Process exit on shutdown
run(app, {
  shutdownHooks: true,
  errorBoundary: true,
  logs: { printThreshold: "info" },
})
  .then((result) => {
    console.log("Application started successfully");
  })
  .catch((error) => {
    console.error("Failed to start application:", error);
    process.exit(1);
  });
