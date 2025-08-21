import { resource, run } from "../index";
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
  AuthenticationError,
  InvalidCredentialsError,
  UserAlreadyExistsError,
  UserNotFoundError,
  TooManyAttemptsError,
  InvalidPasswordResetTokenError,
  InvalidOTPError,
  IAuthConfig,
} from "../globals/auth";

describe("Authentication Tasks", () => {
  const testConfig: IAuthConfig = {
    jwtSecret: "test-secret-12345",
    jwtExpiresIn: 3600,
    defaultRoles: ["user"],
    allowRegistration: true,
  };

  describe("User Registration Task", () => {
    test("should register user successfully", async () => {
      const app = resource({
        id: "test.registration",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with(testConfig),
          registerUserTask,
        ],
        dependencies: { registerUser: registerUserTask },
        init: async (_, { registerUser }) => {
          const result = await registerUser({
            email: "test@example.com",
            password: "password123",
            roles: ["user", "admin"],
          });

          expect(result.user.email).toBe("test@example.com");
          expect(result.user.roles).toEqual(["user", "admin"]);
          expect(result.user.id).toBeTruthy();
          expect(result.token).toBeTruthy(); // registerUser returns token

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle duplicate email registration", async () => {
      const app = resource({
        id: "test.duplicate",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with(testConfig),
          registerUserTask,
        ],
        dependencies: { registerUser: registerUserTask },
        init: async (_, { registerUser }) => {
          // First registration
          await registerUser({
            email: "duplicate@example.com",
            password: "password123",
          });

          // Second registration should fail
          await expect(
            registerUser({
              email: "duplicate@example.com",
              password: "password456",
            })
          ).rejects.toThrow(UserAlreadyExistsError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle invalid registration data", async () => {
      const app = resource({
        id: "test.invalid",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with(testConfig),
          registerUserTask,
        ],
        dependencies: { registerUser: registerUserTask },
        init: async (_, { registerUser }) => {
          // Missing email
          await expect(
            registerUser({
              email: "",
              password: "password123",
            })
          ).rejects.toThrow(AuthenticationError);

          // Missing password
          await expect(
            registerUser({
              email: "test@example.com",
              password: "",
            })
          ).rejects.toThrow(AuthenticationError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("User Authentication Task", () => {
    test("should authenticate user successfully", async () => {
      const app = resource({
        id: "test.authentication",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with(testConfig),
          bruteForceProtectionResource,
          registerUserTask,
          authenticateUserTask,
        ],
        dependencies: {
          registerUser: registerUserTask,
          authenticateUser: authenticateUserTask,
        },
        init: async (_, { registerUser, authenticateUser }) => {
          // First register
          await registerUser({
            email: "auth@example.com",
            password: "password123",
            roles: ["user"],
          });

          // Then authenticate
          const result = await authenticateUser({
            email: "auth@example.com",
            password: "password123",
          });

          expect(result.user.email).toBe("auth@example.com");
          expect(result.token).toBeTruthy();
          expect(result.expiresAt).toBeTruthy();

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle invalid credentials", async () => {
      const app = resource({
        id: "test.invalid.creds",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with(testConfig),
          bruteForceProtectionResource,
          registerUserTask,
          authenticateUserTask,
        ],
        dependencies: {
          registerUser: registerUserTask,
          authenticateUser: authenticateUserTask,
        },
        init: async (_, { registerUser, authenticateUser }) => {
          await registerUser({
            email: "test@example.com",
            password: "password123",
          });

          // Wrong password
          await expect(
            authenticateUser({
              email: "test@example.com",
              password: "wrongpassword",
            })
          ).rejects.toThrow(InvalidCredentialsError);

          // Non-existent user
          await expect(
            authenticateUser({
              email: "nonexistent@example.com",
              password: "password123",
            })
          ).rejects.toThrow(InvalidCredentialsError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle brute force protection", async () => {
      const app = resource({
        id: "test.brute.force",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with(testConfig),
          bruteForceProtectionResource.with({
            maxAttempts: 2,
            initialCooldownSeconds: 1,
          }),
          registerUserTask,
          authenticateUserTask,
        ],
        dependencies: {
          registerUser: registerUserTask,
          authenticateUser: authenticateUserTask,
        },
        init: async (_, { registerUser, authenticateUser }) => {
          await registerUser({
            email: "bruteforce@example.com",
            password: "password123",
          });

          // First failed attempt
          await expect(
            authenticateUser({
              email: "bruteforce@example.com",
              password: "wrong1",
            })
          ).rejects.toThrow(InvalidCredentialsError);

          // Second failed attempt
          await expect(
            authenticateUser({
              email: "bruteforce@example.com",
              password: "wrong2",
            })
          ).rejects.toThrow(InvalidCredentialsError);

          // Third attempt should be blocked
          await expect(
            authenticateUser({
              email: "bruteforce@example.com",
              password: "password123", // Even correct password
            })
          ).rejects.toThrow(TooManyAttemptsError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle missing credentials", async () => {
      const app = resource({
        id: "test.missing.creds",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with(testConfig),
          bruteForceProtectionResource,
          authenticateUserTask,
        ],
        dependencies: { authenticateUser: authenticateUserTask },
        init: async (_, { authenticateUser }) => {
          await expect(
            authenticateUser({
              email: "",
              password: "password123",
            })
          ).rejects.toThrow(AuthenticationError);

          await expect(
            authenticateUser({
              email: "test@example.com",
              password: "",
            })
          ).rejects.toThrow(AuthenticationError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("Password Reset Tasks", () => {
    test("should complete password reset flow", async () => {
      const app = resource({
        id: "test.password.reset",
        register: [
          userStoreResource,
          passwordHasherResource,
          jwtManagerResource.with(testConfig),
          passwordResetServiceResource,
          registerUserTask,
          initiatePasswordResetTask,
          completePasswordResetTask,
          verifyPasswordResetTokenTask,
        ],
        dependencies: {
          registerUser: registerUserTask,
          initiateReset: initiatePasswordResetTask,
          completeReset: completePasswordResetTask,
          verifyToken: verifyPasswordResetTokenTask,
        },
        init: async (_, { registerUser, initiateReset, completeReset, verifyToken }) => {
          await registerUser({
            email: "reset@example.com",
            password: "oldpassword",
          });

          // Initiate reset
          const initiation = await initiateReset({
            email: "reset@example.com",
            callbackUrl: "https://example.com/reset",
          });

          expect(initiation.token).toBeTruthy();
          expect(initiation.expiresAt).toBeTruthy();
          expect(initiation.email).toBe("reset@example.com");

          // Verify token
          const verification = await verifyToken({
            token: initiation.token,
          });

          expect(verification.valid).toBe(true);

          // Complete reset
          const completion = await completeReset({
            token: initiation.token,
            newPassword: "newpassword123",
          });

          expect(completion.success).toBe(true);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle invalid reset tokens", async () => {
      const app = resource({
        id: "test.invalid.reset",
        register: [
          userStoreResource,
          passwordHasherResource,
          passwordResetServiceResource,
          completePasswordResetTask,
          verifyPasswordResetTokenTask,
        ],
        dependencies: {
          completeReset: completePasswordResetTask,
          verifyToken: verifyPasswordResetTokenTask,
        },
        init: async (_, { completeReset, verifyToken }) => {
          // Invalid token verification
          const verification = await verifyToken({
            token: "invalid-token",
          });
          expect(verification.valid).toBe(false);

          // Invalid token completion
          await expect(
            completeReset({
              token: "invalid-token",
              newPassword: "newpassword",
            })
          ).rejects.toThrow(InvalidPasswordResetTokenError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle non-existent user for reset", async () => {
      const app = resource({
        id: "test.nonexistent.reset",
        register: [
          userStoreResource,
          passwordResetServiceResource,
          initiatePasswordResetTask,
        ],
        dependencies: { initiateReset: initiatePasswordResetTask },
        init: async (_, { initiateReset }) => {
          // Should throw UserNotFoundError for non-existent user
          await expect(
            initiateReset({
              email: "nonexistent@example.com",
              callbackUrl: "https://example.com/reset",
            })
          ).rejects.toThrow(UserNotFoundError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });

  describe("OTP Tasks", () => {
    test("should complete OTP flow", async () => {
      const app = resource({
        id: "test.otp",
        register: [
          userStoreResource,
          otpServiceResource,
          enableOTPTask,
          generateOTPTask,
          verifyOTPTask,
          disableOTPTask,
          getOTPStatusTask,
        ],
        dependencies: {
          enableOTP: enableOTPTask,
          generateOTP: generateOTPTask,
          verifyOTP: verifyOTPTask,
          disableOTP: disableOTPTask,
          getStatus: getOTPStatusTask,
          userStore: userStoreResource,
        },
        init: async (_, { enableOTP, generateOTP, verifyOTP, disableOTP, getStatus, userStore }) => {
          const userId = "test-user";

          // Create user first
          await userStore.createUser({
            email: "otp-test@example.com",
            hashedPassword: "hashed-password",
          });

          // Use the actual user ID
          const user = await userStore.findByEmail("otp-test@example.com");
          const actualUserId = user!.id;

          // Enable OTP
          const enableResult = await enableOTP({
            userId: actualUserId,
            type: "email",
          });
          expect(enableResult.success).toBe(true);

          // Check status
          const status = await getStatus({ userId: actualUserId });
          expect(status.enabledTypes).toContain("email");
          expect(status.hasOTPEnabled).toBe(true);

          // Generate OTP
          const generation = await generateOTP({
            userId: actualUserId,
            type: "email",
          });
          expect(generation.code).toBeTruthy();
          expect(generation.expiresAt).toBeTruthy();

          // Verify OTP
          const verification = await verifyOTP({
            userId: actualUserId,
            code: generation.code,
            type: "email",
          });
          expect(verification.success).toBe(true);

          // Disable OTP
          const disableResult = await disableOTP({
            userId: actualUserId,
            type: "email",
          });
          expect(disableResult.success).toBe(true);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle invalid OTP verification", async () => {
      const app = resource({
        id: "test.invalid.otp",
        register: [
          userStoreResource,
          otpServiceResource,
          enableOTPTask,
          verifyOTPTask,
        ],
        dependencies: {
          enableOTP: enableOTPTask,
          verifyOTP: verifyOTPTask,
          userStore: userStoreResource,
        },
        init: async (_, { enableOTP, verifyOTP, userStore }) => {
          const userId = "test-user";

          // Create user first
          await userStore.createUser({
            email: "otp-invalid@example.com",
            hashedPassword: "hashed-password",
          });

          const user = await userStore.findByEmail("otp-invalid@example.com");
          const actualUserId = user!.id;

          await enableOTP({ userId: actualUserId, type: "email" });

          // Invalid code
          await expect(
            verifyOTP({
              userId: actualUserId,
              code: "invalid",
              type: "email",
            })
          ).rejects.toThrow(InvalidOTPError);

          // Disabled type
          await expect(
            verifyOTP({
              userId: actualUserId,
              code: "123456",
              type: "sms",
            })
          ).rejects.toThrow(InvalidOTPError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });

    test("should handle OTP for non-enabled type", async () => {
      const app = resource({
        id: "test.non.enabled",
        register: [
          userStoreResource,
          otpServiceResource,
          generateOTPTask,
        ],
        dependencies: { generateOTP: generateOTPTask, userStore: userStoreResource },
        init: async (_, { generateOTP, userStore }) => {
          // Create user first
          await userStore.createUser({
            email: "otp-noenabled@example.com",
            hashedPassword: "hashed-password",
          });

          const user = await userStore.findByEmail("otp-noenabled@example.com");
          const actualUserId = user!.id;

          await expect(
            generateOTP({
              userId: actualUserId,
              type: "email",
            })
          ).rejects.toThrow(InvalidOTPError);

          return { success: true };
        },
      });

      const { dispose } = await run(app);
      await dispose();
    });
  });
});