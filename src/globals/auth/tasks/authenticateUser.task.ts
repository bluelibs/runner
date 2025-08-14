import { defineTask } from "../../../define";
import {
  IUserCredentials,
  IAuthConfig,
  InvalidCredentialsError,
  AuthenticationError,
} from "../types";
import { userStoreResource } from "../resources/userStore.resource";
import { passwordHasherResource } from "../resources/passwordHasher.resource";
import { jwtManagerResource } from "../resources/jwtManager.resource";

/**
 * User authentication/login task
 */
export const authenticateUserTask = defineTask({
  id: "globals.auth.tasks.authenticateUser",
  dependencies: {
    userStore: userStoreResource,
    passwordHasher: passwordHasherResource,
    jwtManager: jwtManagerResource,
  },
  async run(
    credentials: IUserCredentials,
    { userStore, passwordHasher, jwtManager }
  ) {
    // Validate input
    if (!credentials.email || !credentials.password) {
      throw new AuthenticationError("Email and password are required");
    }

    // Find user by email
    const userData = await userStore.findByEmail(credentials.email);
    if (!userData) {
      throw new InvalidCredentialsError();
    }

    // Extract user without password for return
    const { hashedPassword, ...user } = userData;

    // Check if user is active
    if (!user.isActive) {
      throw new AuthenticationError("User account is not active");
    }

    // Verify password
    if (!hashedPassword) {
      throw new AuthenticationError("User account is not properly configured");
    }

    const isValidPassword = await passwordHasher.verify(
      credentials.password,
      hashedPassword
    );

    if (!isValidPassword) {
      throw new InvalidCredentialsError();
    }

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
  },
  meta: {
    title: "Authenticate User",
    description: "Authenticates a user with email and password",
    tags: ["auth", "login"],
  },
});