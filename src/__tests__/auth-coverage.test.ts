import { 
  SimpleBruteForceProtection,
  SimplePasswordResetService,
  SimpleOTPService,
  MemoryUserStore,
  IUserStore,
  IPasswordHasher,
  IPasswordResetService,
  SimplePasswordHasher
} from "../globals/auth";
import {
  registerUserTask,
  authenticateUserTask,
  initiatePasswordResetTask,
  completePasswordResetTask,
  verifyPasswordResetTokenTask,
  generateOTPTask,
  verifyOTPTask,
  enableOTPTask,
  disableOTPTask,
  getOTPStatusTask,
  userStoreResource,
  passwordHasherResource,
  jwtManagerResource,
  bruteForceProtectionResource,
  passwordResetServiceResource,
  otpServiceResource,
  InvalidPasswordResetTokenError,
  InvalidOTPError,
  UserNotFoundError,
  AuthenticationError,
  TooManyAttemptsError
} from "../globals/auth";
import { resource, run } from "../index";

/**
 * This test file specifically targets uncovered lines to achieve 100% coverage
 */
describe("Auth Coverage Tests", () => {
  describe("BruteForceProtection Edge Cases", () => {
    test("should handle no previous attempts", async () => {
      const protection = new SimpleBruteForceProtection();
      const email = "new-user@example.com";
      
      // Should not be locked for new user
      expect(await protection.isLocked(email)).toBe(false);
      expect(await protection.getCooldownUntil(email)).toBeNull();
      expect(await protection.getAttemptCount(email)).toBe(0);
    });

    test("should reset attempts after reset window expires", async () => {
      // Test line 73 - reset window expiration path
      const protection = new SimpleBruteForceProtection({
        maxAttempts: 3,
        resetWindowSeconds: 0.1, // Very short reset window
      });

      const email = "reset-window@example.com";
      
      // Record first attempt
      await protection.recordFailedAttempt(email);
      expect(await protection.getAttemptCount(email)).toBe(1);
      
      // Wait for reset window to expire
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Next attempt should reset the count due to expired window
      await protection.recordFailedAttempt(email);
      expect(await protection.getAttemptCount(email)).toBe(1); // Reset to 1, not 2
    });

    test("should handle exponential backoff calculation", async () => {
      // Test line 83-98 - cooldown calculation when max attempts reached
      const protection = new SimpleBruteForceProtection({
        maxAttempts: 2,
        initialCooldownSeconds: 1,
        cooldownMultiplier: 2,
        maxCooldownSeconds: 10,
      });

      const email = "cooldown@example.com";
      
      // First and second attempts (reach max)
      await protection.recordFailedAttempt(email);
      await protection.recordFailedAttempt(email);
      
      expect(await protection.isLocked(email)).toBe(true);
      const cooldownUntil = await protection.getCooldownUntil(email);
      expect(cooldownUntil).toBeTruthy();
      
      // Third attempt should trigger exponential backoff calculation
      await protection.recordFailedAttempt(email);
      expect(await protection.isLocked(email)).toBe(true);
    });

    test("should clean up expired cooldowns in isLocked", async () => {
      // Test line 114-121 - expired cooldown cleanup
      const protection = new SimpleBruteForceProtection({
        maxAttempts: 2,
        initialCooldownSeconds: 0.1, // Very short cooldown
      });

      const email = "expired-cooldown@example.com";
      
      // Trigger lockout by reaching max attempts
      await protection.recordFailedAttempt(email);
      await protection.recordFailedAttempt(email);
      expect(await protection.getAttemptCount(email)).toBe(2);
      
      // Should be locked after reaching max attempts
      expect(await protection.isLocked(email)).toBe(true);
      
      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Should no longer be locked and cooldown should be cleaned up
      expect(await protection.isLocked(email)).toBe(false);
    });

    test("should return null for expired cooldown in getCooldownUntil", async () => {
      // Test line 133-136 - expired cooldown return null
      const protection = new SimpleBruteForceProtection({
        maxAttempts: 2,
        initialCooldownSeconds: 0.1,
      });

      const email = "expired-get@example.com";
      
      // Trigger lockout by reaching max attempts
      await protection.recordFailedAttempt(email);
      await protection.recordFailedAttempt(email);
      expect(await protection.getAttemptCount(email)).toBe(2);
      
      // Should have cooldown set
      const initialCooldown = await protection.getCooldownUntil(email);
      expect(initialCooldown).toBeTruthy();
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Should return null for expired cooldown
      const expiredCooldown = await protection.getCooldownUntil(email);
      expect(expiredCooldown).toBeNull();
    });
  });

  describe("Authentication Task Edge Cases", () => {
    test("should handle inactive user authentication", async () => {
      // Test line 50-53 in authenticateUser.task.ts - inactive user check
      const app = resource({
        id: "test.inactive.user",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with({
            jwtSecret: "test-secret",
            jwtExpiresIn: 3600,
          }),
          bruteForceProtectionResource,
          authenticateUserTask,
        ],
        dependencies: {
          authenticateUser: authenticateUserTask,
          userStore: userStoreResource,
        },
        init: async (_, { authenticateUser, userStore }) => {
          // First create a user with a proper password hash
          const hasher = new SimplePasswordHasher();
          const hashedPassword = await hasher.hash("password123");
          
          // Create inactive user
          const user = await userStore.createUser({
            email: "inactive@example.com",
            password: "password123",
            hashedPassword,
            isActive: false, // Set as inactive
          });

          // Try to authenticate inactive user
          await expect(
            authenticateUser({
              email: "inactive@example.com",
              password: "password123",
            })
          ).rejects.toThrow(AuthenticationError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle user without hashed password", async () => {
      // Test line 56-59 in authenticateUser.task.ts - missing hashedPassword
      const app = resource({
        id: "test.no.password",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with({
            jwtSecret: "test-secret",
            jwtExpiresIn: 3600,
          }),
          bruteForceProtectionResource,
          authenticateUserTask,
        ],
        dependencies: {
          authenticateUser: authenticateUserTask,
          userStore: userStoreResource,
        },
        init: async (_, { authenticateUser, userStore }) => {
          // Create user without hashed password
          const userData = {
            email: "nopassword@example.com",
            password: "password123",
            hashedPassword: "", // Empty password
          };
          await userStore.createUser(userData);

          // Try to authenticate
          await expect(
            authenticateUser({
              email: "nopassword@example.com",
              password: "password123",
            })
          ).rejects.toThrow(AuthenticationError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("RegisterUser Task Edge Cases", () => {
    test("should handle short password validation", async () => {
      // Test line 34-37 in registerUser.task.ts - password length validation
      const app = resource({
        id: "test.short.password",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with({
            jwtSecret: "test-secret",
            jwtExpiresIn: 3600,
          }),
          registerUserTask,
        ],
        dependencies: { registerUser: registerUserTask },
        init: async (_, { registerUser }) => {
          await expect(
            registerUser({
              email: "short@example.com",
              password: "123", // Too short
            })
          ).rejects.toThrow(AuthenticationError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("Password Reset Edge Cases", () => {
    test("should handle user not found in complete password reset", async () => {
      // Test line 81-82 in passwordReset.task.ts - user not found in completion
      const app = resource({
        id: "test.reset.not.found",
        register: [
          userStoreResource,
          passwordResetServiceResource,
          passwordHasherResource,
          completePasswordResetTask,
        ],
        dependencies: {
          completeReset: completePasswordResetTask,
          passwordResetService: passwordResetServiceResource,
        },
        init: async (_, { completeReset, passwordResetService }) => {
          // Generate a token for non-existent user
          const resetToken = await passwordResetService.generateResetToken("nonexistent@example.com");

          // Try to complete reset - should fail because user doesn't exist
          await expect(
            completeReset({
              token: resetToken.token,
              newPassword: "newpassword123",
            })
          ).rejects.toThrow(UserNotFoundError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle error in verify password reset token task", async () => {
      // Test line 133-134 in passwordReset.task.ts - error handling in verify task
      const app = resource({
        id: "test.verify.error",
        register: [
          passwordResetServiceResource,
          verifyPasswordResetTokenTask,
        ],
        dependencies: {
          verifyToken: verifyPasswordResetTokenTask,
          passwordResetService: passwordResetServiceResource,
        },
        init: async (_, { verifyToken, passwordResetService }) => {
          // Mock the service to throw a non-InvalidPasswordResetTokenError
          const originalVerify = passwordResetService.verifyResetToken;
          passwordResetService.verifyResetToken = jest.fn().mockRejectedValue(new Error("Database error"));

          // Should propagate the error
          await expect(
            verifyToken({ token: "any-token" })
          ).rejects.toThrow("Database error");

          // Restore original method
          passwordResetService.verifyResetToken = originalVerify;

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("OTP Service Edge Cases", () => {
    test("should handle disabled OTP generation", async () => {
      const app = resource({
        id: "test.otp.disabled",
        register: [
          userStoreResource,
          otpServiceResource,
          generateOTPTask,
        ],
        dependencies: {
          generateOTP: generateOTPTask,
          userStore: userStoreResource,
        },
        init: async (_, { generateOTP, userStore }) => {
          // Create user without enabling OTP
          await userStore.createUser({
            email: "otp-disabled@example.com",
            password: "password123",
            hashedPassword: "hashed-password",
          });

          const user = await userStore.findByEmail("otp-disabled@example.com");

          // Try to generate OTP for disabled type
          await expect(
            generateOTP({
              userId: user!.id,
              type: "email",
            })
          ).rejects.toThrow(InvalidOTPError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle OTP verification for disabled type", async () => {
      const app = resource({
        id: "test.otp.verify.disabled",
        register: [
          userStoreResource,
          otpServiceResource,
          verifyOTPTask,
        ],
        dependencies: {
          verifyOTP: verifyOTPTask,
          userStore: userStoreResource,
        },
        init: async (_, { verifyOTP, userStore }) => {
          // Create user
          await userStore.createUser({
            email: "otp-verify-disabled@example.com",
            password: "password123",
            hashedPassword: "hashed-password",
          });

          const user = await userStore.findByEmail("otp-verify-disabled@example.com");

          // Try to verify OTP for disabled type
          await expect(
            verifyOTP({
              userId: user!.id,
              code: "123456",
              type: "email", // Not enabled
            })
          ).rejects.toThrow(InvalidOTPError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("Memory Store Edge Cases", () => {
    test("should handle user not found scenarios", async () => {
      const store = new MemoryUserStore();
      
      // findByEmail with non-existent user
      const user = await store.findByEmail("nonexistent@example.com");
      expect(user).toBeNull();
      
      // existsByEmail with non-existent user
      const exists = await store.existsByEmail("nonexistent@example.com");
      expect(exists).toBe(false);
      
      // updateUser with non-existent user
      await expect(
        store.updateUser("non-existent-id", { roles: ["admin"] })
      ).rejects.toThrow();
      
      // updatePassword with non-existent user
      await expect(
        store.updatePassword("non-existent-id", "new-password")
      ).rejects.toThrow();
    });

    test("should handle clear operation", async () => {
      const store = new MemoryUserStore();
      
      // Create some users
      await store.createUser({
        email: "user1@example.com",
        password: "password123",
        hashedPassword: "password1",
      });
      await store.createUser({
        email: "user2@example.com",
        password: "password123",
        hashedPassword: "password2",
      });
      
      // Verify users exist
      const list = await store.listUsers();
      expect(list.total).toBe(2);
      
      // Clear store
      await store.clear();
      
      // Verify store is empty
      const emptyList = await store.listUsers();
      expect(emptyList.total).toBe(0);
    });
  });

  describe("Service Initialization Edge Cases", () => {
    test("should handle default configuration values", () => {
      // Test default config initialization
      const bruteForce = new SimpleBruteForceProtection();
      expect(bruteForce).toBeTruthy();
      
      const passwordReset = new SimplePasswordResetService();
      expect(passwordReset).toBeTruthy();
      
      const otp = new SimpleOTPService();
      expect(otp).toBeTruthy();
      
      const userStore = new MemoryUserStore();
      expect(userStore).toBeTruthy();
      
      const passwordHasher = new SimplePasswordHasher();
      expect(passwordHasher).toBeTruthy();
    });

    test("should handle empty OTP enabled types", async () => {
      const otpService = new SimpleOTPService();
      const userId = "test-user";
      
      // Get enabled types for new user
      const enabledTypes = await otpService.getEnabledTypes(userId);
      expect(enabledTypes).toEqual([]);
      
      // Check if any type is enabled
      expect(await otpService.isOTPEnabled(userId, "email")).toBe(false);
      expect(await otpService.isOTPEnabled(userId, "sms")).toBe(false);
      
      // Get active token count for disabled type
      expect(await otpService.getActiveTokenCount(userId, "email")).toBe(0);
    });
  });

  describe("Error Propagation Edge Cases", () => {
    test("should handle TooManyAttemptsError in authentication flow", async () => {
      // Test line 88-90 in authenticateUser.task.ts - TooManyAttemptsError handling
      const app = resource({
        id: "test.too.many.attempts",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with({
            jwtSecret: "test-secret",
            jwtExpiresIn: 3600,
          }),
          bruteForceProtectionResource.with({
            maxAttempts: 2, // Allow 2 attempts
          }),
          authenticateUserTask,
        ],
        dependencies: {
          authenticateUser: authenticateUserTask,
          userStore: userStoreResource,
          bruteForceProtection: bruteForceProtectionResource,
        },
        init: async (_, { authenticateUser, userStore, bruteForceProtection }) => {
          // First create a user with a proper password hash
          const hasher = new SimplePasswordHasher();
          const hashedPassword = await hasher.hash("password123");
          
          // Create user
          await userStore.createUser({
            email: "attempts@example.com",
            password: "password123",
            hashedPassword,
          });

          // First failed attempt
          await expect(
            authenticateUser({
              email: "attempts@example.com",
              password: "wrong-password",
            })
          ).rejects.toThrow("Invalid email or password");

          // Second failed attempt
          await expect(
            authenticateUser({
              email: "attempts@example.com",
              password: "wrong-password2",
            })
          ).rejects.toThrow("Invalid email or password");

          // Check if locked and throw if so - should be locked after 2 failed attempts
          await expect(
            bruteForceProtection.checkAndThrowIfLocked("attempts@example.com")
          ).rejects.toThrow(TooManyAttemptsError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("Password Hasher Edge Cases", () => {
    test("should handle invalid hash format in verify", async () => {
      const hasher = new SimplePasswordHasher();
      
      // Test with invalid hash format (no salt separator)
      const invalidHash = "invalid-hash-without-separator";
      const result = await hasher.verify("any-password", invalidHash);
      expect(result).toBe(false);
      
      // Test with empty hash
      const emptyResult = await hasher.verify("any-password", "");
      expect(emptyResult).toBe(false);
    });
  });
});