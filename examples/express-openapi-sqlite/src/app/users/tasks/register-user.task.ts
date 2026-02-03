import z from "zod";
import { r } from "@bluelibs/runner";
import { httpRoute } from "../../http/tags/http.tag";
import {
  RegisterRequest,
  LoginResponse,
  ApiResponse,
  UserSchema,
} from "../types";
import jwt from "jsonwebtoken";
import { appConfig } from "../../app.config";
import { createUserTask } from "./create-user.task";

// Validation schemas
const registerSchema = z.object({
  email: z.email().meta({ example: "test@example.com" }),
  password: z.string().min(6),
  name: z.string().min(2),
});

/**
 * User registration task
 */
export const registerUserTask = r
  .task("app.tasks.auth.register")
  .dependencies({ appConfig, createUserTask })
  .tags([
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
          user: UserSchema,
        }),
      }),
    }),
  ])
  .inputSchema(registerSchema)
  .run(
    async (
      userData: RegisterRequest,
      { appConfig, createUserTask },
    ): Promise<ApiResponse<LoginResponse>> => {
      try {
        // Create user
        const user = await createUserTask(userData);

        // Generate JWT token
        const token = jwt.sign({ userId: user.id }, appConfig.jwtSecret, {
          expiresIn: "24h",
        });

        return {
          success: true,
          data: {
            token,
            user,
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
  )
  .build();
