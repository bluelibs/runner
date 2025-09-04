import z from "zod";
import { usersRepository } from "../resources/users-repository.resource";
import { httpRoute } from "../../http/tags/http.tag";
import { task } from "@bluelibs/runner";
import { LoginRequest, LoginResponse, ApiResponse } from "../types";
import jwt from "jsonwebtoken";
import { appConfig } from "../../app.config";
import { UserSchema } from "../types";
import { verifyPasswordTask } from "./verify-password.task";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

/**
 * User login task
 */
export const loginUserTask = task({
  id: "app.tasks.auth.login",
  dependencies: {
    userService: usersRepository,
    config: appConfig,
    verifyPasswordTask,
  },
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
          user: UserSchema,
        }),
      }),
    }),
  ],
  run: async (
    loginData: LoginRequest,
    { config, verifyPasswordTask },
  ): Promise<ApiResponse<LoginResponse>> => {
    try {
      // Verify credentials
      const user = await verifyPasswordTask({
        email: loginData.email,
        password: loginData.password,
      });

      if (!user) {
        return {
          success: false,
          error: "Invalid email or password",
        };
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id }, config.jwtSecret, {
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
