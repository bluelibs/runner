import { defineTask } from "../../../define";
import {
  IUserRegistration,
  IAuthConfig,
  UserAlreadyExistsError,
  AuthenticationError,
} from "../types";
import { userStoreResource } from "../resources/userStore.resource";
import { passwordHasherResource } from "../resources/passwordHasher.resource";
import { jwtManagerResource } from "../resources/jwtManager.resource";

/**
 * User registration task
 */
export const registerUserTask = defineTask({
  id: "globals.auth.tasks.registerUser",
  dependencies: {
    userStore: userStoreResource,
    passwordHasher: passwordHasherResource,
    jwtManager: jwtManagerResource,
  },
  async run(
    userData: IUserRegistration,
    { userStore, passwordHasher, jwtManager }
  ) {
    // Validate input
    if (!userData.email || !userData.password) {
      throw new AuthenticationError("Email and password are required");
    }

    // Check password requirements (using default minimum length of 8)
    const minLength = 8;
    if (userData.password.length < minLength) {
      throw new AuthenticationError(
        `Password must be at least ${minLength} characters long`
      );
    }

    // Check if user already exists
    if (await userStore.existsByEmail(userData.email)) {
      throw new UserAlreadyExistsError(userData.email);
    }

    // Hash password
    const hashedPassword = await passwordHasher.hash(userData.password);

    // Create user with default roles
    const user = await userStore.createUser({
      ...userData,
      hashedPassword,
      roles: userData.roles || ["user"],
    });

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
    title: "Register User",
    description: "Creates a new user account with secure password hashing",
    tags: ["auth", "registration"],
  },
});