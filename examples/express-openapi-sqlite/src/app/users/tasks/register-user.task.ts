import { Match, r } from "@bluelibs/runner";
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
const registerSchema = Match.ObjectIncluding({
  email: Match.Email,
  password: Match.RegExp(/^.{8,}$/),
  name: Match.RegExp(/^.{2,}$/),
});

const registerResponseSchema = Match.compile({
  success: Boolean,
  data: Match.ObjectStrict({
    token: Match.NonEmptyString,
    user: UserSchema.pattern,
  }),
});

/**
 * User registration task
 */
export const registerUserTask = r
  .task("register")
  .dependencies({ appConfig, createUserTask })
  .tags([
    httpRoute.post("/api/auth/register", {
      summary: "Register a new user",
      description: "Create a new user account",
      tags: ["Authentication"],
      requiresAuth: false,
      requestBodySchema: registerSchema,
      responseSchema: registerResponseSchema,
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
        const user = await createUserTask({
          email: userData.email,
          password: userData.password,
          name: userData.name,
        });

        // Generate JWT token
        const token = jwt.sign({ id: user.id }, appConfig.jwtSecret, {
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
