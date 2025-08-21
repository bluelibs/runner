// Note: This adapter requires the 'mongodb' package to be installed
// npm install mongodb @types/mongodb

import {
  IUser,
  IUserStore,
  IUserRegistration,
  IUserWithPassword,
  UserAlreadyExistsError,
  UserNotFoundError,
} from "../types";

/**
 * MongoDB document interface
 */
interface IUserDocument {
  _id?: any;
  email: string;
  hashedPassword: string;
  roles: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastPasswordChangedAt?: Date;
  metadata: Record<string, any>;
}

/**
 * MongoDB-like collection interface for type safety
 */
interface IMongoCollection {
  createIndex(spec: any, options?: any): Promise<any>;
  insertOne(doc: any): Promise<{ insertedId: any }>;
  findOne(filter: any, options?: any): Promise<any>;
  findOneAndUpdate(filter: any, update: any, options?: any): Promise<any>;
  deleteOne(filter: any): Promise<{ deletedCount: number }>;
  countDocuments(filter: any, options?: any): Promise<number>;
  find(filter: any, options?: any): { skip(n: number): any; limit(n: number): any; toArray(): Promise<any[]> };
  drop(): Promise<void>;
}

/**
 * MongoDB-like database interface for type safety
 */
interface IMongoDb {
  collection(name: string): IMongoCollection;
  stats(): Promise<any>;
}

/**
 * MongoDB-based user store implementation
 * 
 * Usage:
 * ```typescript
 * import { MongoClient } from "mongodb";
 * import { MongoUserStore } from "@bluelibs/runner/auth/adapters";
 * 
 * const client = new MongoClient("mongodb://localhost:27017");
 * await client.connect();
 * const db = client.db("myapp");
 * 
 * const userStore = new MongoUserStore(db, "users");
 * 
 * // Use with auth system
 * globals.resources.auth.userStore.with({ store: userStore })
 * ```
 */
export class MongoUserStore implements IUserStore {
  private collection: IMongoCollection;

  constructor(
    private db: IMongoDb,
    collectionName: string = "users"
  ) {
    this.collection = db.collection(collectionName);
    this.createIndexes();
  }

  /**
   * Create necessary indexes for performance
   */
  private async createIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ email: 1 }, { unique: true });
      await this.collection.createIndex({ roles: 1 });
      await this.collection.createIndex({ isActive: 1 });
      await this.collection.createIndex({ createdAt: 1 });
    } catch (error) {
      // Indexes might already exist, that's okay
    }
  }

  async createUser(userData: IUserRegistration & { hashedPassword?: string }): Promise<IUser> {
    if (await this.existsByEmail(userData.email)) {
      throw new UserAlreadyExistsError(userData.email);
    }

    const now = new Date();
    const document: IUserDocument = {
      email: userData.email,
      hashedPassword: userData.hashedPassword || "",
      roles: userData.roles || [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
      lastPasswordChangedAt: now,
      metadata: userData.metadata || {},
    };

    const result = await this.collection.insertOne(document);
    
    return {
      id: result.insertedId.toString(),
      email: document.email,
      roles: document.roles,
      isActive: document.isActive,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      lastPasswordChangedAt: document.lastPasswordChangedAt,
      metadata: document.metadata,
    };
  }

  async findByEmail(email: string): Promise<(IUser & { hashedPassword?: string }) | null> {
    const document = await this.collection.findOne({ email });
    if (!document) {
      return null;
    }

    return this.documentToUser(document);
  }

  async findById(id: string): Promise<(IUser & { hashedPassword?: string }) | null> {
    try {
      const document = await this.collection.findOne({ _id: this.toObjectId(id) });
      if (!document) {
        return null;
      }

      return this.documentToUser(document);
    } catch (error) {
      return null; // Invalid ObjectId format
    }
  }

  async updateUser(id: string, updates: Partial<IUser>): Promise<IUser> {
    const updateDoc: Partial<IUserDocument> = {
      ...updates,
      updatedAt: new Date(),
    };

    // Remove fields that shouldn't be updated this way
    delete (updateDoc as any).id;
    delete (updateDoc as any).hashedPassword;

    try {
      const result = await this.collection.findOneAndUpdate(
        { _id: this.toObjectId(id) },
        { $set: updateDoc },
        { returnDocument: "after" }
      );

      if (!result) {
        throw new UserNotFoundError(id);
      }

      const { hashedPassword, ...user } = this.documentToUser(result);
      return user;
    } catch (error) {
      if (error instanceof UserNotFoundError) {
        throw error;
      }
      throw new UserNotFoundError(id);
    }
  }

  async updatePassword(id: string, hashedPassword: string): Promise<IUser> {
    const now = new Date();
    
    try {
      const result = await this.collection.findOneAndUpdate(
        { _id: this.toObjectId(id) },
        { 
          $set: { 
            hashedPassword,
            lastPasswordChangedAt: now,
            updatedAt: now 
          } 
        },
        { returnDocument: "after" }
      );

      if (!result) {
        throw new UserNotFoundError(id);
      }

      const { hashedPassword: _, ...user } = this.documentToUser(result);
      return user;
    } catch (error) {
      if (error instanceof UserNotFoundError) {
        throw error;
      }
      throw new UserNotFoundError(id);
    }
  }

  async deleteUser(id: string): Promise<void> {
    try {
      const result = await this.collection.deleteOne({ _id: this.toObjectId(id) });
      if (result.deletedCount === 0) {
        throw new UserNotFoundError(id);
      }
    } catch (error) {
      if (error instanceof UserNotFoundError) {
        throw error;
      }
      throw new UserNotFoundError(id);
    }
  }

  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.collection.countDocuments({ email }, { limit: 1 });
    return count > 0;
  }

  async listUsers(options?: {
    limit?: number;
    offset?: number;
    roles?: string[];
    isActive?: boolean;
  }): Promise<{ users: IUser[]; total: number }> {
    const filter: any = {};

    if (options?.isActive !== undefined) {
      filter.isActive = options.isActive;
    }

    if (options?.roles && options.roles.length > 0) {
      filter.roles = { $in: options.roles };
    }

    const total = await this.collection.countDocuments(filter);

    const cursor = this.collection.find(filter, {
      projection: { hashedPassword: 0 }, // Exclude password from results
    });

    if (options?.offset) {
      cursor.skip(options.offset);
    }

    if (options?.limit) {
      cursor.limit(options.limit);
    }

    const documents = await cursor.toArray();
    const users = documents.map((doc: IUserDocument) => {
      const { hashedPassword, ...user } = this.documentToUser(doc);
      return user;
    });

    return { users, total };
  }

  /**
   * Convert MongoDB document to user object
   */
  private documentToUser(document: IUserDocument): IUser & { hashedPassword?: string } {
    return {
      id: document._id.toString(),
      email: document.email,
      roles: document.roles,
      isActive: document.isActive,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      lastPasswordChangedAt: document.lastPasswordChangedAt,
      metadata: document.metadata,
      hashedPassword: document.hashedPassword,
    };
  }

  /**
   * Convert string ID to MongoDB ObjectId
   * Note: This requires the actual mongodb package
   */
  private toObjectId(id: string): any {
    // In a real implementation, this would be:
    // const { ObjectId } = require("mongodb");
    // return new ObjectId(id);
    
    // For type safety without mongodb dependency:
    return { toString: () => id };
  }

  /**
   * Drop the collection (for testing)
   */
  async drop(): Promise<void> {
    await this.collection.drop();
  }

  /**
   * Get collection stats (for testing)
   */
  async getStats(): Promise<any> {
    return await this.db.stats();
  }
}