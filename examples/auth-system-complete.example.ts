/**
 * Complete authentication system example for BlueLibs Runner
 * 
 * This example demonstrates:
 * - User registration and authentication
 * - JWT token handling
 * - Role-based access control
 * - Protected tasks and resources
 * - Custom user storage integration
 */

import { 
  resource, 
  task, 
  run, 
  globals, 
  middleware 
} from "@bluelibs/runner";

import { 
  UserContext, 
  authMiddleware, 
  jwtMiddleware,
  IUser,
  IUserStore,
  IUserRegistration,
  createAuthSystem
} from "@bluelibs/runner/auth";

// Example: Custom database user store (replace MemoryUserStore in production)
class DatabaseUserStore implements IUserStore {
  // Implement your database logic here
  // This is just a placeholder showing the interface
  
  async createUser(userData: IUserRegistration & { hashedPassword?: string }): Promise<IUser> {
    // INSERT INTO users (email, hashed_password, roles, ...) VALUES (...)
    throw new Error("Implement your database logic here");
  }

  async findByEmail(email: string): Promise<(IUser & { hashedPassword?: string }) | null> {
    // SELECT * FROM users WHERE email = ?
    throw new Error("Implement your database logic here");
  }

  async findById(id: string): Promise<(IUser & { hashedPassword?: string }) | null> {
    // SELECT * FROM users WHERE id = ?
    throw new Error("Implement your database logic here");
  }

  async updateUser(id: string, updates: Partial<IUser>): Promise<IUser> {
    // UPDATE users SET ... WHERE id = ?
    throw new Error("Implement your database logic here");
  }

  async deleteUser(id: string): Promise<void> {
    // DELETE FROM users WHERE id = ?
    throw new Error("Implement your database logic here");
  }

  async existsByEmail(email: string): Promise<boolean> {
    // SELECT 1 FROM users WHERE email = ? LIMIT 1
    throw new Error("Implement your database logic here");
  }

  async listUsers(options?: any): Promise<{ users: IUser[]; total: number }> {
    // SELECT * FROM users WHERE ... LIMIT ? OFFSET ?
    throw new Error("Implement your database logic here");
  }
}

// Example: Protected business logic tasks
const getUserProfile = task({
  id: "app.tasks.getUserProfile",
  middleware: [authMiddleware.with({ required: true })],
  run: async (input: { userId?: string }) => {
    const { user } = UserContext.use();
    
    // Users can only access their own profile unless they're admin
    const targetUserId = input.userId || user.id;
    if (targetUserId !== user.id && !user.roles.includes("admin")) {
      throw new Error("Access denied: Can only access your own profile");
    }

    return {
      id: user.id,
      email: user.email,
      roles: user.roles,
      isActive: user.isActive,
      // Don't return sensitive data
    };
  },
});

const adminOnlyTask = task({
  id: "app.tasks.adminOnly", 
  middleware: [
    authMiddleware.with({ 
      roles: ["admin"], 
      roleCheck: "any" 
    })
  ],
  run: async () => {
    const { user } = UserContext.use();
    return `Admin-only operation performed by ${user.email}`;
  },
});

const superAdminTask = task({
  id: "app.tasks.superAdminOnly",
  middleware: [
    authMiddleware.with({ 
      roles: ["super_admin"],
      roleCheck: "any"
    })
  ],
  run: async () => {
    const { user } = UserContext.use();
    return `Super admin operation performed by ${user.email}`;
  },
});

// Example: API endpoint simulation with JWT middleware
const apiEndpoint = task({
  id: "app.api.endpoint",
  middleware: [
    jwtMiddleware.with({ 
      tokenSource: "input",
      tokenProperty: "authorization" 
    })
  ],
  run: async (input: { authorization: string; data: any }) => {
    const { user } = UserContext.use();
    
    return {
      message: `API call successful for ${user.email}`,
      data: input.data,
      timestamp: new Date().toISOString(),
    };
  },
});

// Example: Express-like middleware integration
const httpRequestTask = task({
  id: "app.http.request",
  middleware: [
    jwtMiddleware.with({ 
      tokenSource: "header",
      extractToken: (input) => {
        // Extract Bearer token from headers
        const authHeader = input?.headers?.authorization;
        return authHeader?.startsWith("Bearer ") 
          ? authHeader.substring(7) 
          : null;
      }
    })
  ],
  run: async (input: { 
    headers: { authorization?: string };
    body: any;
    path: string;
  }) => {
    const { user } = UserContext.use();
    
    return {
      user: { id: user.id, email: user.email, roles: user.roles },
      path: input.path,
      body: input.body,
      timestamp: new Date().toISOString(),
    };
  },
});

// Main application
const authExampleApp = resource({
  id: "app.auth.example",
  register: [
    // Option 1: Register individual auth components
    globals.resources.auth.userStore, // Uses MemoryUserStore by default
    globals.resources.auth.passwordHasher,
    globals.resources.auth.jwtManager.with({
      jwtSecret: process.env.JWT_SECRET || "your-super-secret-jwt-key",
      jwtExpiresIn: 24 * 60 * 60, // 24 hours
    }),
    globals.resources.auth.permissionChecker,
    globals.tasks.auth.registerUser,
    globals.tasks.auth.authenticateUser,
    
    // Option 2: Or use the complete auth system factory
    // createAuthSystem({
    //   jwtSecret: process.env.JWT_SECRET || "your-super-secret-jwt-key", 
    //   jwtExpiresIn: 24 * 60 * 60,
    //   defaultRoles: ["user"],
    //   allowRegistration: true,
    // }),
    
    // Register business logic
    getUserProfile,
    adminOnlyTask,
    superAdminTask,
    apiEndpoint,
    httpRequestTask,
    
    // Option 3: Override with custom user store
    // globals.resources.auth.userStore.with({ store: new DatabaseUserStore() }),
  ],
  dependencies: {
    registerUser: globals.tasks.auth.registerUser,
    authenticateUser: globals.tasks.auth.authenticateUser,
    getUserProfile,
    adminOnlyTask,
    superAdminTask,
    apiEndpoint,
    httpRequestTask,
  },
  init: async (_, deps) => {
    console.log("🚀 Starting authentication example...\n");

    // 1. Register users
    console.log("👤 Registering users...");
    const regularUser = await deps.registerUser({
      email: "user@example.com",
      password: "userpassword123",
      roles: ["user"],
    });
    console.log(`✅ Regular user registered: ${regularUser.user.email}`);

    const adminUser = await deps.registerUser({
      email: "admin@example.com", 
      password: "adminpassword123",
      roles: ["user", "admin"],
    });
    console.log(`✅ Admin user registered: ${adminUser.user.email}`);

    // 2. Authenticate users
    console.log("\n🔑 Authenticating users...");
    const userAuth = await deps.authenticateUser({
      email: "user@example.com",
      password: "userpassword123",
    });
    console.log(`✅ User authenticated: ${userAuth.user.email}`);

    const adminAuth = await deps.authenticateUser({
      email: "admin@example.com",
      password: "adminpassword123", 
    });
    console.log(`✅ Admin authenticated: ${adminAuth.user.email}`);

    // 3. Test protected endpoints
    console.log("\n🛡️ Testing protected endpoints...");

    // User accessing their own profile
    const userProfile = await UserContext.provide(
      { user: userAuth.user, token: userAuth.token },
      () => deps.getUserProfile({})
    );
    console.log(`✅ User profile: ${userProfile.email} (${userProfile.roles.join(", ")})`);

    // Admin accessing admin-only endpoint
    const adminResult = await UserContext.provide(
      { user: adminAuth.user, token: adminAuth.token },
      () => deps.adminOnlyTask()
    );
    console.log(`✅ Admin task: ${adminResult}`);

    // 4. Test JWT middleware
    console.log("\n🎫 Testing JWT middleware...");
    
    const apiResult = await deps.apiEndpoint({
      authorization: userAuth.token,
      data: { message: "Hello from API!" },
    });
    console.log(`✅ API endpoint: ${apiResult.message}`);

    const httpResult = await deps.httpRequestTask({
      headers: { authorization: `Bearer ${adminAuth.token}` },
      body: { action: "getData" },
      path: "/api/data",
    });
    console.log(`✅ HTTP request: User ${httpResult.user.email} accessed ${httpResult.path}`);

    // 5. Test error scenarios
    console.log("\n❌ Testing error scenarios...");
    
    try {
      // User trying to access admin endpoint
      await UserContext.provide(
        { user: userAuth.user, token: userAuth.token },
        () => deps.adminOnlyTask()
      );
    } catch (error) {
      console.log(`✅ Correctly blocked user from admin endpoint: ${error.message}`);
    }

    try {
      // Invalid JWT token
      await deps.apiEndpoint({
        authorization: "invalid-token",
        data: {},
      });
    } catch (error) {
      console.log(`✅ Correctly rejected invalid JWT: ${error.message}`);
    }

    console.log("\n🎉 Authentication example completed successfully!");
    
    return {
      users: {
        regular: regularUser.user,
        admin: adminUser.user,
      },
      tokens: {
        regular: userAuth.token,
        admin: adminAuth.token,
      },
    };
  },
});

// Run the example
export async function runAuthExample() {
  const { value: result, dispose } = await run(authExampleApp);
  
  console.log("\n📊 Example Results:");
  console.log(`Regular User: ${result.users.regular.email} (${result.users.regular.roles.join(", ")})`);
  console.log(`Admin User: ${result.users.admin.email} (${result.users.admin.roles.join(", ")})`);
  console.log(`Regular Token: ${result.tokens.regular.substring(0, 20)}...`);
  console.log(`Admin Token: ${result.tokens.admin.substring(0, 20)}...`);
  
  await dispose();
  console.log("\n🧹 Resources disposed successfully");
  
  return result;
}

// Run if this file is executed directly
if (require.main === module) {
  runAuthExample().catch(console.error);
}