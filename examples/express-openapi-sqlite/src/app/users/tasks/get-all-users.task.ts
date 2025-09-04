import z from "zod";
import { task } from "@bluelibs/runner";
import { usersRepository } from "../resources/users-repository.resource";
import { authMiddleware } from "../middleware/auth";
import { httpRoute } from "../../http/tags/http.tag";
import { UserContext } from "../contexts/user.context";
import { ApiResponse } from "../../http/types";
import { User, UserSchema } from "../types";

/**
 * Get all users (protected admin route)
 */
export const getAllUsersTask = task({
  id: "app.tasks.users.getAll",
  dependencies: { userService: usersRepository },
  middleware: [authMiddleware.with({ requiresAuth: true })],
  tags: [
    httpRoute.get("/api/users", {
      summary: "Get all users",
      description: "Get a list of all registered users (admin only)",
      tags: ["User", "Admin"],
      requiresAuth: true,
      responseSchema: z.object({
        success: z.boolean(),
        data: z.array(UserSchema),
      }),
    }),
  ],
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
