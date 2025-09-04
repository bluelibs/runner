import { resource } from "@bluelibs/runner";
import bcrypt from "bcryptjs";
import { User, RegisterRequest } from "../types";
import { db } from "../../db/database";

export const usersRepository = resource({
  id: "app.resources.userService",
  dependencies: { database: db },
  init: async (_, { database }) => {
    return {
      async getUserByEmail(email: string): Promise<User | null> {
        const user = await database.get<User>(
          "SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?",
          [email]
        );

        if (!user) return null;

        return {
          ...user,
          id: user.id.toString(),
          createdAt: new Date(user.createdAt),
        };
      },

      async getUserById(id: string): Promise<User | null> {
        const user = await database.get<User>(
          "SELECT id, email, name, created_at FROM users WHERE id = ?",
          [id]
        );

        if (!user) return null;

        return {
          ...user,
          id: user.id.toString(),
          createdAt: new Date(user.createdAt),
        };
      },

      async getAllUsers(): Promise<User[]> {
        const users = await database.all<User>(
          "SELECT id, email, name, created_at FROM users ORDER BY created_at DESC"
        );

        return users.map((user: any) => ({
          ...user,
          id: user.id.toString(),
          createdAt: new Date(user.createdAt),
        }));
      },
    };
  },
});
