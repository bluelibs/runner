import { Match, r } from "@bluelibs/runner";
import { usersRepository } from "../resources/users-repository.resource";
import { authMiddleware } from "../middleware/auth";
import { httpRoute } from "../../http/tags/http.tag";
import { UserContext } from "../contexts/user.context";
import { ApiResponse } from "../../http/types";
import { User, UserSchema } from "../types";

const usersResponseSchema = Match.compile({
  success: Boolean,
  data: Match.ArrayOf(UserSchema.pattern),
});

/**
 * Get all users (protected admin route)
 */
export const getAllUsersTask = r
  .task("getAll")
  .dependencies({ userService: usersRepository })
  .middleware([authMiddleware.with({ requiresAuth: true })])
  .tags([
    httpRoute.get("/api/users", {
      summary: "Get all users",
      description: "Get a list of all registered users (admin only)",
      tags: ["User", "Admin"],
      requiresAuth: true,
      responseSchema: usersResponseSchema,
    }),
  ])
  .run(async (_, { userService }): Promise<ApiResponse<User[]>> => {
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
  })
  .build();
