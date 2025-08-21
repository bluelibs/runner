// Note: This adapter requires the 'pg' package to be installed
// npm install pg @types/pg

import {
  IUser,
  IUserStore,
  IUserRegistration,
  UserAlreadyExistsError,
  UserNotFoundError,
} from "../types";

/**
 * PostgreSQL row interface
 */
interface IUserRow {
  id: string;
  email: string;
  hashed_password: string;
  roles: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_password_changed_at?: Date;
  metadata: Record<string, any>;
}

/**
 * PostgreSQL-like pool/client interface for type safety
 */
interface IPgConnection {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number }>;
}

/**
 * PostgreSQL-based user store implementation
 * 
 * Usage:
 * ```typescript
 * import { Pool } from "pg";
 * import { PostgresUserStore } from "@bluelibs/runner/auth/adapters";
 * 
 * const pool = new Pool({
 *   host: "localhost",
 *   port: 5432,
 *   database: "myapp",
 *   user: "postgres",
 *   password: "password",
 * });
 * 
 * const userStore = new PostgresUserStore(pool, "users");
 * await userStore.createTable(); // Create table if it doesn't exist
 * 
 * // Use with auth system
 * globals.resources.auth.userStore.with({ store: userStore })
 * ```
 */
export class PostgresUserStore implements IUserStore {
  constructor(
    private pool: IPgConnection,
    private tableName: string = "users"
  ) {}

  /**
   * Create the users table if it doesn't exist
   */
  async createTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        hashed_password TEXT NOT NULL,
        roles TEXT[] DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_email ON ${this.tableName}(email);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_roles ON ${this.tableName} USING GIN(roles);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_is_active ON ${this.tableName}(is_active);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at ON ${this.tableName}(created_at);
    `;

    await this.pool.query(query);
  }

  async createUser(userData: IUserRegistration & { hashedPassword?: string }): Promise<IUser> {
    if (await this.existsByEmail(userData.email)) {
      throw new UserAlreadyExistsError(userData.email);
    }

    const query = `
      INSERT INTO ${this.tableName} (email, hashed_password, roles, metadata, last_password_changed_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, email, roles, is_active, created_at, updated_at, last_password_changed_at, metadata
    `;

    const values = [
      userData.email,
      userData.hashedPassword || "",
      userData.roles || [],
      JSON.stringify(userData.metadata || {}),
    ];

    const result = await this.pool.query(query, values);
    return this.rowToUser(result.rows[0]);
  }

  async findByEmail(email: string): Promise<(IUser & { hashedPassword?: string }) | null> {
    const query = `
      SELECT id, email, hashed_password, roles, is_active, created_at, updated_at, last_password_changed_at, metadata
      FROM ${this.tableName}
      WHERE email = $1
    `;

    const result = await this.pool.query(query, [email]);
    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToUserWithPassword(result.rows[0]);
  }

  async findById(id: string): Promise<(IUser & { hashedPassword?: string }) | null> {
    const query = `
      SELECT id, email, hashed_password, roles, is_active, created_at, updated_at, last_password_changed_at, metadata
      FROM ${this.tableName}
      WHERE id = $1
    `;

    try {
      const result = await this.pool.query(query, [id]);
      if (result.rows.length === 0) {
        return null;
      }

      return this.rowToUserWithPassword(result.rows[0]);
    } catch (error) {
      return null; // Invalid UUID format or other error
    }
  }

  async updateUser(id: string, updates: Partial<IUser>): Promise<IUser> {
    // Build dynamic update query
    const updateFields: string[] = [];
    const values: any[] = [];
    let valueIndex = 1;

    if (updates.email !== undefined) {
      updateFields.push(`email = $${valueIndex++}`);
      values.push(updates.email);
    }

    if (updates.roles !== undefined) {
      updateFields.push(`roles = $${valueIndex++}`);
      values.push(updates.roles);
    }

    if (updates.isActive !== undefined) {
      updateFields.push(`is_active = $${valueIndex++}`);
      values.push(updates.isActive);
    }

    if (updates.metadata !== undefined) {
      updateFields.push(`metadata = $${valueIndex++}`);
      values.push(JSON.stringify(updates.metadata));
    }

    if (updateFields.length === 0) {
      // No updates, just return current user
      const current = await this.findById(id);
      if (!current) {
        throw new UserNotFoundError(id);
      }
      const { hashedPassword, ...user } = current;
      return user;
    }

    updateFields.push(`updated_at = NOW()`);
    values.push(id); // Add ID as last parameter

    const query = `
      UPDATE ${this.tableName}
      SET ${updateFields.join(", ")}
      WHERE id = $${valueIndex}
      RETURNING id, email, roles, is_active, created_at, updated_at, last_password_changed_at, metadata
    `;

    const result = await this.pool.query(query, values);
    if (result.rows.length === 0) {
      throw new UserNotFoundError(id);
    }

    return this.rowToUser(result.rows[0]);
  }

  async updatePassword(id: string, hashedPassword: string): Promise<IUser> {
    const query = `
      UPDATE ${this.tableName}
      SET hashed_password = $1, last_password_changed_at = NOW(), updated_at = NOW()
      WHERE id = $2
      RETURNING id, email, roles, is_active, created_at, updated_at, last_password_changed_at, metadata
    `;

    const result = await this.pool.query(query, [hashedPassword, id]);
    if (result.rows.length === 0) {
      throw new UserNotFoundError(id);
    }

    return this.rowToUser(result.rows[0]);
  }

  async deleteUser(id: string): Promise<void> {
    const query = `DELETE FROM ${this.tableName} WHERE id = $1`;
    const result = await this.pool.query(query, [id]);
    
    if (result.rowCount === 0) {
      throw new UserNotFoundError(id);
    }
  }

  async existsByEmail(email: string): Promise<boolean> {
    const query = `SELECT 1 FROM ${this.tableName} WHERE email = $1 LIMIT 1`;
    const result = await this.pool.query(query, [email]);
    return result.rows.length > 0;
  }

  async listUsers(options?: {
    limit?: number;
    offset?: number;
    roles?: string[];
    isActive?: boolean;
  }): Promise<{ users: IUser[]; total: number }> {
    // Build where clause
    const whereConditions: string[] = [];
    const whereValues: any[] = [];
    let valueIndex = 1;

    if (options?.isActive !== undefined) {
      whereConditions.push(`is_active = $${valueIndex++}`);
      whereValues.push(options.isActive);
    }

    if (options?.roles && options.roles.length > 0) {
      whereConditions.push(`roles && $${valueIndex++}`);
      whereValues.push(options.roles);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM ${this.tableName} ${whereClause}`;
    const countResult = await this.pool.query(countQuery, whereValues);
    const total = parseInt(countResult.rows[0].count);

    // Get users (excluding password)
    let query = `
      SELECT id, email, roles, is_active, created_at, updated_at, last_password_changed_at, metadata
      FROM ${this.tableName}
      ${whereClause}
      ORDER BY created_at DESC
    `;

    const queryValues = [...whereValues];

    if (options?.limit !== undefined) {
      query += ` LIMIT $${valueIndex++}`;
      queryValues.push(options.limit);
    }

    if (options?.offset !== undefined) {
      query += ` OFFSET $${valueIndex++}`;
      queryValues.push(options.offset);
    }

    const result = await this.pool.query(query, queryValues);
    const users = result.rows.map(row => this.rowToUser(row));

    return { users, total };
  }

  /**
   * Convert PostgreSQL row to user object (without password)
   */
  private rowToUser(row: any): IUser {
    return {
      id: row.id,
      email: row.email,
      roles: row.roles,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastPasswordChangedAt: row.last_password_changed_at,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    };
  }

  /**
   * Convert PostgreSQL row to user object (with password)
   */
  private rowToUserWithPassword(row: any): IUser & { hashedPassword?: string } {
    return {
      ...this.rowToUser(row),
      hashedPassword: row.hashed_password,
    };
  }

  /**
   * Drop the table (for testing)
   */
  async dropTable(): Promise<void> {
    await this.pool.query(`DROP TABLE IF EXISTS ${this.tableName} CASCADE`);
  }

  /**
   * Truncate the table (for testing)
   */
  async truncate(): Promise<void> {
    await this.pool.query(`TRUNCATE TABLE ${this.tableName} RESTART IDENTITY CASCADE`);
  }

  /**
   * Get table stats (for testing)
   */
  async getStats(): Promise<any> {
    const query = `
      SELECT 
        schemaname,
        tablename,
        attname,
        n_distinct,
        correlation
      FROM pg_stats 
      WHERE tablename = $1
    `;
    
    const result = await this.pool.query(query, [this.tableName]);
    return result.rows;
  }
}