import z from "zod";
import { task } from "@bluelibs/runner";
import { usersRepository } from "../repository/users.repository";
import { authMiddleware } from "../middleware/auth";
import { httpRoute } from "../../http/http.tag";
import { UserContext } from "../user.context";
import { ApiResponse } from "../../types";
import { User, UserSchema } from "../types";

/**
 * Get all users (protected admin route)
 */
export const getAllUsersTask = task({
  id: "app.tasks.users.getAll",
  dependencies: { userService: usersRepository },
  middleware: [authMiddleware.with({ requiresAuth: true })],
  meta: {
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
