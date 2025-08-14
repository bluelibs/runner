import { resource } from "@bluelibs/runner";
import bcrypt from "bcryptjs";
import { User, RegisterRequest } from "../types";
import { databaseResource, Database } from "./database";

export interface UserService {
  createUser(userData: RegisterRequest): Promise<User>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  verifyPassword(email: string, password: string): Promise<User | null>;
  getAllUsers(): Promise<User[]>;
}

export const userServiceResource = resource({
  id: "app.resources.userService",
  dependencies: { database: databaseResource },
  init: async (_, { database }): Promise<UserService> => {
    return {
      async createUser(userData: RegisterRequest): Promise<User> {
        const { email, password, name } = userData;
        
        // Check if user already exists
        const existing = await database.get(
          'SELECT id FROM users WHERE email = ?',
          [email]
        );
        
        if (existing) {
          throw new Error('User with this email already exists');
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Insert user
        const result = await database.run(
          'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
          [email, name, passwordHash]
        );
        
        // Return created user
        const user = await database.get<User>(
          'SELECT id, email, name, created_at FROM users WHERE id = ?',
          [result.lastID]
        );
        
        if (!user) {
          throw new Error('Failed to create user');
        }

        return {
          ...user,
          id: user.id.toString(),
          createdAt: new Date(user.createdAt)
        };
      },

      async getUserByEmail(email: string): Promise<User | null> {
        const user = await database.get<User>(
          'SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?',
          [email]
        );
        
        if (!user) return null;
        
        return {
          ...user,
          id: user.id.toString(),
          createdAt: new Date(user.createdAt)
        };
      },

      async getUserById(id: string): Promise<User | null> {
        const user = await database.get<User>(
          'SELECT id, email, name, created_at FROM users WHERE id = ?',
          [id]
        );
        
        if (!user) return null;
        
        return {
          ...user,
          id: user.id.toString(),
          createdAt: new Date(user.createdAt)
        };
      },

      async verifyPassword(email: string, password: string): Promise<User | null> {
        const user = await database.get<User & { password_hash: string }>(
          'SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?',
          [email]
        );
        
        if (!user) return null;
        
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return null;
        
        return {
          id: user.id.toString(),
          email: user.email,
          name: user.name,
          createdAt: new Date(user.createdAt)
        };
      },

      async getAllUsers(): Promise<User[]> {
        const users = await database.all<User>(
          'SELECT id, email, name, created_at FROM users ORDER BY created_at DESC'
        );
        
        return users.map((user: any) => ({
          ...user,
          id: user.id.toString(),
          createdAt: new Date(user.createdAt)
        }));
      }
    };
  }
});