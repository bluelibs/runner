import { r } from "@bluelibs/runner";
import { httpRoute } from "../../http/tags/http.tag";
import { authMiddleware } from "../middleware/auth";
import { UserContext } from "../contexts/user.context";
import { RequestContext } from "../../http/contexts/request.context";
import { ApiResponse } from "../../http/types";
import { User, UserSchema } from "../types";
import z from "zod";

/**
 * Get current user profile (protected route)
 */
export const getUserProfileTask = r
  .task("app.tasks.auth.profile")
  .middleware([authMiddleware.with({ requiresAuth: true })])
  .tags([
    httpRoute.get("/api/auth/profile", {
      summary: "Get current user profile",
      description: "Get the authenticated user's profile information",
      tags: ["Authentication", "User"],
      requiresAuth: true,
      responseSchema: z.object({
        success: z.boolean(),
        data: UserSchema,
      }),
    }),
  ])
  .run(async (): Promise<ApiResponse<User>> => {
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
  })
  .build();
