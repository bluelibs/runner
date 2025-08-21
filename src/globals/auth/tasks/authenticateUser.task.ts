import { defineTask } from "../../../define";
import {
  IUserCredentials,
  IAuthConfig,
  InvalidCredentialsError,
  AuthenticationError,
  IBruteForceProtection,
  TooManyAttemptsError,
} from "../types";
import { userStoreResource } from "../resources/userStore.resource";
import { passwordHasherResource } from "../resources/passwordHasher.resource";
import { jwtManagerResource } from "../resources/jwtManager.resource";
import { bruteForceProtectionResource } from "../resources/bruteForceProtection.resource";

/**
 * User authentication/login task with brute force protection
 */
export const authenticateUserTask = defineTask({
  id: "globals.auth.tasks.authenticateUser",
  dependencies: {
    userStore: userStoreResource,
    passwordHasher: passwordHasherResource,
    jwtManager: jwtManagerResource,
    bruteForceProtection: bruteForceProtectionResource,
  },
  async run(
    credentials: IUserCredentials,
    { userStore, passwordHasher, jwtManager, bruteForceProtection }
  ) {
    // Validate input
    if (!credentials.email || !credentials.password) {
      throw new AuthenticationError("Email and password are required");
    }

    // Check brute force protection
    await bruteForceProtection.checkAndThrowIfLocked(credentials.email);

    try {
      // Find user by email
      const userData = await userStore.findByEmail(credentials.email);
      if (!userData) {
        await bruteForceProtection.recordFailedAttempt(credentials.email);
        throw new InvalidCredentialsError();
      }

      // Extract user without password for return
      const { hashedPassword, ...user } = userData;

      // Check if user is active
      if (!user.isActive) {
        await bruteForceProtection.recordFailedAttempt(credentials.email);
        throw new AuthenticationError("User account is not active");
      }

      // Verify password
      if (!hashedPassword) {
        await bruteForceProtection.recordFailedAttempt(credentials.email);
        throw new AuthenticationError("User account is not properly configured");
      }

      const isValidPassword = await passwordHasher.verify(
        credentials.password,
        hashedPassword
      );

      if (!isValidPassword) {
        await bruteForceProtection.recordFailedAttempt(credentials.email);
        throw new InvalidCredentialsError();
      }

      // Success - reset failed attempts
      await bruteForceProtection.resetAttempts(credentials.email);

      // Generate JWT token (default to 24 hours)
      const token = await jwtManager.generate({
        userId: user.id,
        email: user.email,
        roles: user.roles,
      });

      return {
        user,
        token,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      };
    } catch (error) {
      // If it's already a TooManyAttemptsError, don't double-record
      if (error instanceof TooManyAttemptsError) {
        throw error;
      }
      // For other errors, the failed attempt was already recorded above
      throw error;
    }
  },
  meta: {
    title: "Authenticate User",
    description: "Authenticates a user with email and password, includes brute force protection",
    tags: ["auth", "login", "security"],
  },
});