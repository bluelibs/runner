import { task } from "@bluelibs/runner";
import { RegisterRequest, User } from "../types";
import { db } from "../../db/database";
import bcrypt from "bcryptjs";

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
}

export const createUserTask = task({
  id: "app.tasks.users.createUser",
  dependencies: { db },
  run: async (userData: CreateUserInput, { db }) => {
    const { email, password, name } = userData;

    // Check if user already exists
    const existing = await db.get("SELECT id FROM users WHERE email = ?", [
      email,
    ]);

    if (existing) {
      throw new Error("User with this email already exists");
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const result = await db.run(
      "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)",
      [email, name, passwordHash]
    );

    // Return created user
    const user = await db.get<User>(
      "SELECT id, email, name, created_at FROM users WHERE id = ?",
      [result.lastID]
    );

    if (!user) {
      throw new Error("Failed to create user");
    }

    return {
      ...user,
      id: user.id.toString(),
      createdAt: new Date(user.createdAt),
    };
  },
});
