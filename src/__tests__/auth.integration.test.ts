import { task, resource, run } from "../index";
import { 
  UserContext, 
  authMiddleware, 
  jwtMiddleware,
  registerUserTask,
  authenticateUserTask,
  userStoreResource,
  passwordHasherResource,
  jwtManagerResource,
  permissionCheckerResource,
  bruteForceProtectionResource,
  MemoryUserStore,
  SimplePasswordHasher,
  SimpleJWTManager,
  BasicPermissionChecker,
  AuthenticationError,
  AuthorizationError,
  InvalidCredentialsError,
  UserAlreadyExistsError,
  IAuthConfig
} from "../globals/auth";

describe("Authentication System", () => {
  const testConfig: IAuthConfig = {
    jwtSecret: "test-secret-12345",
    jwtExpiresIn: 3600,
    defaultRoles: ["user"],
    allowRegistration: true,
  };

  describe("Core Services", () => {
    test("MemoryUserStore should manage users correctly", async () => {
      const store = new MemoryUserStore();
      
      // Create user
      const user = await store.createUser({
        email: "test@example.com",
        password: "password123",
        hashedPassword: "hashed-password",
        roles: ["user"],
      });
      
      expect(user.email).toBe("test@example.com");
      expect(user.roles).toEqual(["user"]);
      expect(user.isActive).toBe(true);
      
      // Find by email
      const foundUser = await store.findByEmail("test@example.com");
      expect(foundUser).toBeTruthy();
      expect(foundUser!.email).toBe("test@example.com");
      
      // Check existence
      expect(await store.existsByEmail("test@example.com")).toBe(true);
      expect(await store.existsByEmail("nonexistent@example.com")).toBe(false);
      
      // List users
      const userList = await store.listUsers();
      expect(userList.total).toBe(1);
      expect(userList.users[0].email).toBe("test@example.com");
    });

    test("SimplePasswordHasher should hash and verify passwords", async () => {
      const hasher = new SimplePasswordHasher();
      
      const password = "testpassword123";
      const hash = await hasher.hash(password);
      
      expect(hash).toBeTruthy();
      expect(hash).not.toBe(password);
      expect(hash).toContain(":");
      
      // Verify correct password
      expect(await hasher.verify(password, hash)).toBe(true);
      
      // Verify incorrect password
      expect(await hasher.verify("wrongpassword", hash)).toBe(false);
    });

    test("SimpleJWTManager should generate and verify tokens", async () => {
      const jwtManager = new SimpleJWTManager("test-secret", 3600);
      
      const payload = {
        userId: "123",
        email: "test@example.com",
        roles: ["user", "admin"],
      };
      
      const token = await jwtManager.generate(payload);
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);
      
      // Verify token
      const verified = await jwtManager.verify(token);
      expect(verified.userId).toBe(payload.userId);
      expect(verified.email).toBe(payload.email);
      expect(verified.roles).toEqual(payload.roles);
      expect(verified.iat).toBeTruthy();
      expect(verified.exp).toBeTruthy();
    });

    test("BasicPermissionChecker should handle role-based permissions", async () => {
      const checker = new BasicPermissionChecker();
      
      const user = {
        id: "1",
        email: "test@example.com",
        roles: ["user"],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      const adminUser = { ...user, roles: ["admin"] };
      const superAdminUser = { ...user, roles: ["super_admin"] };
      
      // Basic permission check
      expect(await checker.hasPermission({ user })).toBe(true);
      expect(await checker.hasPermission({ user: { ...user, isActive: false } })).toBe(false);
      
      // Role checks
      expect(await checker.hasRole(user, ["user"])).toBe(true);
      expect(await checker.hasRole(user, ["admin"])).toBe(false);
      expect(await checker.hasRole(adminUser, ["user"])).toBe(true); // admin inherits user
      expect(await checker.hasRole(superAdminUser, ["admin", "user"])).toBe(true);
      
      // Super admin can do anything
      expect(await checker.hasPermission({ user: superAdminUser })).toBe(true);
    });
  });

  describe("Integration", () => {
    test("complete auth flow should work end-to-end", async () => {
      const protectedTask = task({
        id: "integration.protected",
        middleware: [jwtMiddleware.with({ 
          tokenSource: "input",
          tokenProperty: "authorization" 
        })],
        run: async () => {
          const { user } = UserContext.use();
          return {
            message: `Access granted to ${user.email}`,
            roles: user.roles,
          };
        },
      });

      const app = resource({
        id: "test.integration",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with(testConfig),
          permissionCheckerResource,
          bruteForceProtectionResource,
          registerUserTask,
          authenticateUserTask,
          jwtMiddleware,
          protectedTask,
        ],
        dependencies: {
          registerUser: registerUserTask,
          authenticateUser: authenticateUserTask,
          protectedTask,
        },
        init: async (_: any, { registerUser, authenticateUser, protectedTask }: any) => {
          // 1. Register user
          const registration = await registerUser({
            email: "integration@example.com",
            password: "securepassword123",
            roles: ["user", "premium"],
          });
          
          expect(registration.user.email).toBe("integration@example.com");
          expect(registration.user.roles).toEqual(["user", "premium"]);
          
          // 2. Authenticate user
          const auth = await authenticateUser({
            email: "integration@example.com",
            password: "securepassword123",
          });
          
          expect(auth.user.email).toBe("integration@example.com");
          expect(auth.token).toBeTruthy();
          
          // 3. Use JWT token to access protected resource
          const result = await protectedTask({
            authorization: auth.token,
          });
          
          expect(result.message).toBe("Access granted to integration@example.com");
          expect(result.roles).toEqual(["user", "premium"]);
          
          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });
});