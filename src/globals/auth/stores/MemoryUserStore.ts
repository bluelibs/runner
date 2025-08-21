import {
  IUser,
  IUserStore,
  IUserRegistration,
  UserAlreadyExistsError,
  UserNotFoundError,
  IUserWithPassword,
} from "../types";

/**
 * Simple memory-based user store for demonstration and testing
 * In production, replace this with a database-backed implementation
 */
export class MemoryUserStore implements IUserStore {
  private users: Map<string, IUserWithPassword> = new Map();
  private nextId = 1;

  async createUser(userData: IUserRegistration & { hashedPassword?: string }): Promise<IUser> {
    if (await this.existsByEmail(userData.email)) {
      throw new UserAlreadyExistsError(userData.email);
    }

    const now = new Date();
    const user: IUserWithPassword = {
      id: (this.nextId++).toString(),
      email: userData.email,
      roles: userData.roles || [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
      lastPasswordChangedAt: now, // Set when password is first created
      metadata: userData.metadata || {},
      hashedPassword: userData.hashedPassword || "",
    };

    this.users.set(user.id, user);
    
    // Return user without password
    const { hashedPassword, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async findByEmail(email: string): Promise<(IUser & { hashedPassword?: string }) | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return { ...user };
      }
    }
    return null;
  }

  async findById(id: string): Promise<(IUser & { hashedPassword?: string }) | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async updateUser(id: string, updates: Partial<IUser>): Promise<IUser> {
    const user = this.users.get(id);
    if (!user) {
      throw new UserNotFoundError(id);
    }

    const updatedUser: IUserWithPassword = {
      ...user,
      ...updates,
      id: user.id, // Prevent ID modification
      hashedPassword: user.hashedPassword, // Preserve password
      updatedAt: new Date(),
    };

    this.users.set(id, updatedUser);
    
    // Return user without password
    const { hashedPassword, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }

  async updatePassword(id: string, hashedPassword: string): Promise<IUser> {
    const user = this.users.get(id);
    if (!user) {
      throw new UserNotFoundError(id);
    }

    const now = new Date();
    const updatedUser: IUserWithPassword = {
      ...user,
      hashedPassword,
      lastPasswordChangedAt: now,
      updatedAt: now,
    };

    this.users.set(id, updatedUser);
    
    // Return user without password
    const { hashedPassword: _, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }

  async deleteUser(id: string): Promise<void> {
    if (!this.users.has(id)) {
      throw new UserNotFoundError(id);
    }
    this.users.delete(id);
  }

  async existsByEmail(email: string): Promise<boolean> {
    return (await this.findByEmail(email)) !== null;
  }

  async listUsers(options?: {
    limit?: number;
    offset?: number;
    roles?: string[];
    isActive?: boolean;
  }): Promise<{ users: IUser[]; total: number }> {
    let users = Array.from(this.users.values());

    // Apply filters
    if (options?.isActive !== undefined) {
      users = users.filter((user) => user.isActive === options.isActive);
    }

    if (options?.roles && options.roles.length > 0) {
      users = users.filter((user) =>
        options.roles!.some((role) => user.roles.includes(role))
      );
    }

    const total = users.length;

    // Apply pagination
    const offset = options?.offset || 0;
    const limit = options?.limit || total;
    users = users.slice(offset, offset + limit);

    // Return users without passwords
    return {
      users: users.map((user) => {
        const { hashedPassword, ...userWithoutPassword } = user;
        return userWithoutPassword;
      }),
      total,
    };
  }

  /**
   * Clear all users (for testing)
   */
  async clear(): Promise<void> {
    this.users.clear();
    this.nextId = 1;
  }

  /**
   * Get current user count (for testing)
   */
  size(): number {
    return this.users.size;
  }
}