import { task } from "@bluelibs/runner";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { httpRoute } from "../tags/httpTag";
import { userServiceResource, UserService } from "../resources/userService";
import { authMiddleware } from "../middleware/auth";
import { UserContext, RequestContext } from "../contexts";
import {
  RegisterRequest,
  LoginRequest,
  LoginResponse,
  ApiResponse,
  User,
} from "../types";

// Validation schemas
const registerSchema = z.object({
  email: z.email().meta({ example: "test@example.com" }),
  password: z.string().min(6),
  name: z.string().min(2),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

/**
 * User registration task
 */
export const registerUserTask = task({
  id: "app.tasks.auth.register",
  dependencies: { userService: userServiceResource },
  meta: {
    tags: [
      httpRoute.post("/api/auth/register", {
        summary: "Register a new user",
        description: "Create a new user account",
        tags: ["Authentication"],
        requiresAuth: false,
        requestBodySchema: registerSchema,
        responseSchema: z.object({
          success: z.boolean(),
          data: z.object({
            token: z.string(),
            user: z.object({
              id: z.string(),
              email: z.string(),
              name: z.string(),
              createdAt: z.date(),
            }),
          }),
        }),
      }),
    ],
  },
  run: async (
    userData: RegisterRequest,
    { userService }
  ): Promise<ApiResponse<LoginResponse>> => {
    try {
      // Create user
      const user = await userService.createUser(userData);

      // Generate JWT token
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: "24h",
      });

      // Remove password hash from response
      const { passwordHash, ...userWithoutPassword } = user;

      return {
        success: true,
        data: {
          token,
          user: userWithoutPassword,
        },
        message: "User registered successfully",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Registration failed",
      };
    }
  },
});

/**
 * User login task
 */
export const loginUserTask = task({
  id: "app.tasks.auth.login",
  dependencies: { userService: userServiceResource },
  meta: {
    tags: [
      httpRoute.post("/api/auth/login", {
        summary: "User login",
        description: "Authenticate user and return JWT token",
        tags: ["Authentication"],
        requiresAuth: false,
        requestBodySchema: loginSchema,
        responseSchema: z.object({
          success: z.boolean(),
          data: z.object({
            token: z.string(),
            user: z.object({
              id: z.string(),
              email: z.string(),
              name: z.string(),
              createdAt: z.date(),
            }),
          }),
        }),
      }),
    ],
  },
  run: async (
    loginData: LoginRequest,
    { userService }
  ): Promise<ApiResponse<LoginResponse>> => {
    try {
      // Verify credentials
      const user = await userService.verifyPassword(
        loginData.email,
        loginData.password
      );

      if (!user) {
        return {
          success: false,
          error: "Invalid email or password",
        };
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: "24h",
      });

      return {
        success: true,
        data: {
          token,
          user,
        },
        message: "Login successful",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Login failed",
      };
    }
  },
});

/**
 * Get current user profile (protected route)
 */
export const getUserProfileTask = task({
  id: "app.tasks.auth.profile",
  middleware: [
    authMiddleware.with({ jwtSecret: JWT_SECRET, requiresAuth: true }),
  ],
  meta: {
    tags: [
      httpRoute.get("/api/auth/profile", {
        summary: "Get current user profile",
        description: "Get the authenticated user's profile information",
        tags: ["Authentication", "User"],
        requiresAuth: true,
        responseSchema: z.object({
          success: z.boolean(),
          data: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string(),
            createdAt: z.date(),
          }),
        }),
      }),
    ],
  },
  run: async (): Promise<ApiResponse<User>> => {
    try {
      // Get user from context (set by auth middleware)
      const userSession = UserContext.use();
      const requestData = RequestContext.use();

      return {
        success: true,
        data: {
          id: userSession.userId,
          email: userSession.email,
          name: userSession.name,
          createdAt: new Date(), // In real app, would come from database
        },
        message: "Profile retrieved successfully",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get profile",
      };
    }
  },
});

/**
 * Get all users (protected admin route)
 */
export const getAllUsersTask = task({
  id: "app.tasks.users.getAll",
  dependencies: { userService: userServiceResource },
  middleware: [
    authMiddleware.with({ jwtSecret: JWT_SECRET, requiresAuth: true }),
  ],
  meta: {
    tags: [
      httpRoute.get("/api/users", {
        summary: "Get all users",
        description: "Get a list of all registered users (admin only)",
        tags: ["User", "Admin"],
        requiresAuth: true,
        responseSchema: z.object({
          success: z.boolean(),
          data: z.array(
            z.object({
              id: z.string(),
              email: z.string(),
              name: z.string(),
              createdAt: z.date(),
            })
          ),
        }),
      }),
    ],
  },
  run: async (_, { userService }): Promise<ApiResponse<User[]>> => {
    try {
      // In a real app, you might check for admin role here
      const userSession = UserContext.use();

      const users = await userService.getAllUsers();

      return {
        success: true,
        data: users,
        message: "Users retrieved successfully",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get users",
      };
    }
  },
});
