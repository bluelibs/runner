import { task } from "@bluelibs/runner";
import { db } from "../../db/resources/database";
import { User } from "../types";
import bcrypt from "bcryptjs";

export interface VerifyPasswordInput {
  email: string;
  password: string;
}

export const verifyPasswordTask = task({
  id: "app.tasks.users.verifyPassword",
  dependencies: { db },
  run: async (input: VerifyPasswordInput, { db }) => {
    const user = await db.get<User & { password_hash: string }>(
      "SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?",
      [input.email],
    );

    if (!user) return null;

    const isValid = await bcrypt.compare(input.password, user.password_hash);
    if (!isValid) return null;

    return {
      id: user.id.toString(),
      email: user.email,
      name: user.name,
      createdAt: new Date(user.createdAt),
    };
  },
});
