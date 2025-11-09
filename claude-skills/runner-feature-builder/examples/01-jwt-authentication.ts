/**
 * JWT Authentication Example
 *
 * Demonstrates:
 * - JWT middleware for authentication
 * - Async context for storing auth data
 * - Role-based access control (RBAC)
 * - Protecting tasks with auth middleware
 */

import { r, run } from "@bluelibs/runner";
import jwt from "jsonwebtoken";

// Auth context to store authenticated user info
const authContext = r
  .asyncContext<{ userId: string; role: string }>("auth")
  .build();

// JWT authentication middleware
const jwtAuth = r.middleware
  .task("jwtAuth")
  .configSchema<{ secret: string }>({ parse: (v) => v })
  .dependencies({ authContext })
  .run(async ({ task, next }, { authContext }, config) => {
    // Get token from input (in real app, from headers)
    const token = task.input.token;

    if (!token) {
      throw new Error("No authentication token provided");
    }

    try {
      // Verify JWT
      const decoded = jwt.verify(token, config.secret) as {
        userId: string;
        role: string;
      };

      // Provide auth context for this execution
      return await authContext.provide(
        { userId: decoded.userId, role: decoded.role },
        async () => next(task.input)
      );
    } catch (error) {
      throw new Error(`Invalid token: ${error.message}`);
    }
  })
  .build();

// RBAC middleware
const rbacMiddleware = r.middleware
  .task("rbac")
  .configSchema<{ allowedRoles: string[] }>({ parse: (v) => v })
  .dependencies({ authContext })
  .run(async ({ task, next }, { authContext }, config) => {
    const auth = authContext.use();

    if (!config.allowedRoles.includes(auth.role)) {
      throw new Error(
        `Forbidden: requires one of [${config.allowedRoles.join(", ")}]`
      );
    }

    return next(task.input);
  })
  .build();

// Mock database
const db = r
  .resource("db")
  .init(async () => ({
    users: {
      findById: async (id: string) => ({
        id,
        name: "John Doe",
        email: "john@example.com",
      }),
    },
    admin: {
      deleteUser: async (id: string) => ({ deleted: true, id }),
    },
  }))
  .build();

// Public task (no auth required)
const getHealth = r
  .task("getHealth")
  .run(async () => ({ status: "ok", timestamp: Date.now() }))
  .build();

// Protected task (requires auth)
const getProfile = r
  .task("getProfile")
  .middleware([jwtAuth.with({ secret: "test-secret" })])
  .dependencies({ authContext, db })
  .run(async (_input, { authContext, db }) => {
    const auth = authContext.use();
    const user = await db.users.findById(auth.userId);
    return { ...user, role: auth.role };
  })
  .build();

// Admin-only task
const deleteUser = r
  .task("deleteUser")
  .inputSchema<{ userId: string; token: string }>({ parse: (v) => v })
  .middleware([
    jwtAuth.with({ secret: "test-secret" }),
    rbacMiddleware.with({ allowedRoles: ["admin"] }),
  ])
  .dependencies({ db })
  .run(async (input, { db }) => {
    return await db.admin.deleteUser(input.userId);
  })
  .build();

// App
const app = r
  .resource("app")
  .register([authContext, jwtAuth, rbacMiddleware, db, getHealth, getProfile, deleteUser])
  .build();

async function main() {
  const { runTask, dispose } = await run(app);

  // Generate test tokens
  const userToken = jwt.sign(
    { userId: "user-123", role: "user" },
    "test-secret"
  );

  const adminToken = jwt.sign(
    { userId: "admin-456", role: "admin" },
    "test-secret"
  );

  console.log("1. Public endpoint (no auth):");
  const health = await runTask(getHealth);
  console.log("  Response:", health);

  console.log("\n2. Protected endpoint (with user token):");
  const profile = await runTask(getProfile, { token: userToken });
  console.log("  Response:", profile);

  console.log("\n3. Admin endpoint (with user token - should fail):");
  try {
    await runTask(deleteUser, { userId: "user-789", token: userToken });
  } catch (error) {
    console.log("  Expected error:", error.message);
  }

  console.log("\n4. Admin endpoint (with admin token - should succeed):");
  const deleted = await runTask(deleteUser, {
    userId: "user-789",
    token: adminToken,
  });
  console.log("  Response:", deleted);

  console.log("\n5. Protected endpoint (no token - should fail):");
  try {
    await runTask(getProfile, { token: null });
  } catch (error) {
    console.log("  Expected error:", error.message);
  }

  await dispose();
}

if (require.main === module) {
  main().catch(console.error);
}

export { authContext, jwtAuth, rbacMiddleware, getProfile, deleteUser, app };
