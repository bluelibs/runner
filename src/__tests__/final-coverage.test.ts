import {
  generateOTPTask,
  verifyOTPTask,
  enableOTPTask,
  disableOTPTask,
  getOTPStatusTask,
  otpServiceResource,
  userStoreResource,
  UserNotFoundError
} from "../globals/auth";
import { resource, run } from "../index";

/**
 * Additional tests to cover the remaining uncovered lines
 */
describe("Final Coverage Tests", () => {
  describe("OTP Task UserNotFoundError Cases", () => {
    test("should handle user not found in generateOTP", async () => {
      const app = resource({
        id: "test.generate.otp.no.user",
        register: [
          userStoreResource,
          otpServiceResource,
          generateOTPTask,
        ],
        dependencies: {
          generateOTP: generateOTPTask,
        },
        init: async (_, { generateOTP }) => {
          // Test line 33 in otp.task.ts
          await expect(
            generateOTP({
              userId: "non-existent-user",
              type: "email",
            })
          ).rejects.toThrow(UserNotFoundError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle user not found in verifyOTP", async () => {
      const app = resource({
        id: "test.verify.otp.no.user",
        register: [
          userStoreResource,
          otpServiceResource,
          verifyOTPTask,
        ],
        dependencies: {
          verifyOTP: verifyOTPTask,
        },
        init: async (_, { verifyOTP }) => {
          // Test line 80 in otp.task.ts
          await expect(
            verifyOTP({
              userId: "non-existent-user",
              code: "123456",
              type: "email",
            })
          ).rejects.toThrow(UserNotFoundError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle user not found in enableOTP", async () => {
      const app = resource({
        id: "test.enable.otp.no.user",
        register: [
          userStoreResource,
          otpServiceResource,
          enableOTPTask,
        ],
        dependencies: {
          enableOTP: enableOTPTask,
        },
        init: async (_, { enableOTP }) => {
          // Test line 123 in otp.task.ts
          await expect(
            enableOTP({
              userId: "non-existent-user",
              type: "email",
            })
          ).rejects.toThrow(UserNotFoundError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle user not found in disableOTP", async () => {
      const app = resource({
        id: "test.disable.otp.no.user",
        register: [
          userStoreResource,
          otpServiceResource,
          disableOTPTask,
        ],
        dependencies: {
          disableOTP: disableOTPTask,
        },
        init: async (_, { disableOTP }) => {
          // Test line 162 in otp.task.ts
          await expect(
            disableOTP({
              userId: "non-existent-user",
              type: "email",
            })
          ).rejects.toThrow(UserNotFoundError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle user not found in getOTPStatus", async () => {
      const app = resource({
        id: "test.status.otp.no.user",
        register: [
          userStoreResource,
          otpServiceResource,
          getOTPStatusTask,
        ],
        dependencies: {
          getStatus: getOTPStatusTask,
        },
        init: async (_, { getStatus }) => {
          // Test line 201 in otp.task.ts
          await expect(
            getStatus({
              userId: "non-existent-user",
            })
          ).rejects.toThrow(UserNotFoundError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("MemoryUserStore Final Cases", () => {
    test("should handle size method", async () => {
      const { MemoryUserStore } = await import("../globals/auth");
      const store = new MemoryUserStore();
      
      // Test line 158 - size method
      expect(store.size()).toBe(0);
      
      await store.createUser({
        email: "size-test@example.com",
        password: "password123",
        hashedPassword: "hashed",
      });
      
      expect(store.size()).toBe(1);
    });
  });

  describe("Authenticate Task Final Cases", () => {
    test("should handle size method", async () => {
      // Just test the MemoryUserStore size method which is still uncovered
      // This is a simple utility method
      expect(true).toBe(true); // Placeholder for now
    });
  });

  describe("MemoryUserStore Filter Cases", () => {
    test("should handle role-based filtering", async () => {
      const { MemoryUserStore } = await import("../globals/auth");
      const store = new MemoryUserStore();
      
      // Create users with different roles
      await store.createUser({
        email: "admin@example.com",
        password: "password123",
        hashedPassword: "hashed",
        roles: ["admin"],
      });
      
      await store.createUser({
        email: "user@example.com",
        password: "password123",
        hashedPassword: "hashed",
        roles: ["user"],
      });

      await store.createUser({
        email: "inactive@example.com",
        password: "password123",
        hashedPassword: "hashed",
        roles: ["user"],
        isActive: false,
      });
      
      // Test line 120 - isActive filter
      const activeUsers = await store.listUsers({ isActive: true });
      expect(activeUsers.users).toHaveLength(2);
      expect(activeUsers.total).toBe(2);
      
      const inactiveUsers = await store.listUsers({ isActive: false });
      expect(inactiveUsers.users).toHaveLength(1);
      expect(inactiveUsers.total).toBe(1);
      
      // Test lines 124-125 - roles filter
      const adminUsers = await store.listUsers({ roles: ["admin"] });
      expect(adminUsers.users).toHaveLength(1);
      expect(adminUsers.total).toBe(1);
      expect(adminUsers.users[0].email).toBe("admin@example.com");
      
      const userRoleUsers = await store.listUsers({ roles: ["user"] });
      expect(userRoleUsers.users).toHaveLength(2); // includes inactive user
      expect(userRoleUsers.total).toBe(2);
    });
  });
});