import { MongoUserStore } from "../globals/auth/adapters/MongoUserStore";
import { PostgresUserStore } from "../globals/auth/adapters/PostgresUserStore";
import { UserAlreadyExistsError, UserNotFoundError } from "../globals/auth/types";

// Mock MongoDB interfaces
const mockMongoCollection = {
  createIndex: jest.fn().mockResolvedValue({}),
  insertOne: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  deleteOne: jest.fn(),
  countDocuments: jest.fn(),
  find: jest.fn(),
  drop: jest.fn().mockResolvedValue({}),
};

const mockMongoCursor = {
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn(),
};

mockMongoCollection.find.mockReturnValue(mockMongoCursor);

const mockMongoDb = {
  collection: jest.fn().mockReturnValue(mockMongoCollection),
  stats: jest.fn().mockResolvedValue({ ok: 1 }),
};

// Mock PostgreSQL interface
const mockPgPool = {
  query: jest.fn(),
};

describe("Database Adapters", () => {
  describe("MongoUserStore", () => {
    let userStore: MongoUserStore;

    beforeEach(() => {
      jest.clearAllMocks();
      userStore = new MongoUserStore(mockMongoDb as any, "test_users");
    });

    test("should create user successfully", async () => {
      const userData = {
        email: "test@example.com",
        password: "password123",
        hashedPassword: "hashed-password",
        roles: ["user"],
      };

      mockMongoCollection.countDocuments.mockResolvedValueOnce(0); // Email doesn't exist
      mockMongoCollection.insertOne.mockResolvedValueOnce({
        insertedId: { toString: () => "507f1f77bcf86cd799439011" }
      });

      const user = await userStore.createUser(userData);

      expect(user.id).toBe("507f1f77bcf86cd799439011");
      expect(user.email).toBe(userData.email);
      expect(user.roles).toEqual(userData.roles);
      expect(user.isActive).toBe(true);
      expect(user.lastPasswordChangedAt).toBeTruthy();
      expect(mockMongoCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          email: userData.email,
          hashedPassword: userData.hashedPassword,
          roles: userData.roles,
          isActive: true,
        })
      );
    });

    test("should throw error for duplicate email", async () => {
      const userData = {
        email: "test@example.com",
        password: "password123",
        hashedPassword: "hashed-password",
      };

      mockMongoCollection.countDocuments.mockResolvedValueOnce(1); // Email exists

      await expect(userStore.createUser(userData)).rejects.toThrow(UserAlreadyExistsError);
    });

    test("should find user by email", async () => {
      const email = "test@example.com";
      const mockUser = {
        _id: { toString: () => "507f1f77bcf86cd799439011" },
        email: email,
        hashedPassword: "hashed-password",
        roles: ["user"],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastPasswordChangedAt: new Date(),
        metadata: {},
      };

      mockMongoCollection.findOne.mockResolvedValueOnce(mockUser);

      const user = await userStore.findByEmail(email);

      expect(user).toBeTruthy();
      expect(user!.id).toBe("507f1f77bcf86cd799439011");
      expect(user!.email).toBe(email);
      expect(user!.hashedPassword).toBe("hashed-password");
    });

    test("should update user password with timestamp", async () => {
      const userId = "507f1f77bcf86cd799439011";
      const newHashedPassword = "new-hashed-password";
      const mockUpdatedUser = {
        _id: { toString: () => userId },
        email: "test@example.com",
        hashedPassword: newHashedPassword,
        roles: ["user"],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastPasswordChangedAt: new Date(),
        metadata: {},
      };

      mockMongoCollection.findOneAndUpdate.mockResolvedValueOnce(mockUpdatedUser);

      const user = await userStore.updatePassword(userId, newHashedPassword);

      expect(user.id).toBe(userId);
      expect(mockMongoCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: expect.anything() },
        { 
          $set: { 
            hashedPassword: newHashedPassword,
            lastPasswordChangedAt: expect.any(Date),
            updatedAt: expect.any(Date)
          } 
        },
        { returnDocument: "after" }
      );
    });

    test("should list users with filtering", async () => {
      const mockUsers = [
        {
          _id: { toString: () => "507f1f77bcf86cd799439011" },
          email: "user1@example.com",
          roles: ["user"],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {},
        },
        {
          _id: { toString: () => "507f1f77bcf86cd799439012" },
          email: "admin@example.com",
          roles: ["admin"],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {},
        },
      ];

      mockMongoCollection.countDocuments.mockResolvedValueOnce(2);
      mockMongoCursor.toArray.mockResolvedValueOnce(mockUsers);

      const result = await userStore.listUsers({
        limit: 10,
        offset: 0,
        roles: ["admin"],
        isActive: true,
      });

      expect(result.total).toBe(2);
      expect(result.users).toHaveLength(2);
      expect(result.users[1].email).toBe("admin@example.com");
    });
  });

  describe("PostgresUserStore", () => {
    let userStore: PostgresUserStore;

    beforeEach(() => {
      jest.clearAllMocks();
      userStore = new PostgresUserStore(mockPgPool as any, "test_users");
    });

    test("should create user successfully", async () => {
      const userData = {
        email: "test@example.com",
        password: "password123",
        hashedPassword: "hashed-password",
        roles: ["user"],
        metadata: { source: "registration" },
      };

      const mockUser = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        email: userData.email,
        roles: userData.roles,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        last_password_changed_at: new Date(),
        metadata: userData.metadata,
      };

      mockPgPool.query
        .mockResolvedValueOnce({ rows: [] }) // existsByEmail check
        .mockResolvedValueOnce({ rows: [mockUser] }); // insert

      const user = await userStore.createUser(userData);

      expect(user.id).toBe(mockUser.id);
      expect(user.email).toBe(userData.email);
      expect(user.roles).toEqual(userData.roles);
      expect(user.isActive).toBe(true);
      expect(user.metadata).toEqual(userData.metadata);
    });

    test("should throw error for duplicate email", async () => {
      const userData = {
        email: "test@example.com",
        password: "password123",
        hashedPassword: "hashed-password",
      };

      mockPgPool.query.mockResolvedValueOnce({ rows: [{ email: userData.email }] }); // Email exists

      await expect(userStore.createUser(userData)).rejects.toThrow(UserAlreadyExistsError);
    });

    test("should find user by email", async () => {
      const email = "test@example.com";
      const mockUser = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        email: email,
        hashed_password: "hashed-password",
        roles: ["user"],
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        last_password_changed_at: new Date(),
        metadata: {},
      };

      mockPgPool.query.mockResolvedValueOnce({ rows: [mockUser] });

      const user = await userStore.findByEmail(email);

      expect(user).toBeTruthy();
      expect(user!.id).toBe(mockUser.id);
      expect(user!.email).toBe(email);
      expect(user!.hashedPassword).toBe("hashed-password");
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT"),
        [email]
      );
    });

    test("should update user password with timestamp", async () => {
      const userId = "550e8400-e29b-41d4-a716-446655440000";
      const newHashedPassword = "new-hashed-password";
      const mockUpdatedUser = {
        id: userId,
        email: "test@example.com",
        roles: ["user"],
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        last_password_changed_at: new Date(),
        metadata: {},
      };

      mockPgPool.query.mockResolvedValueOnce({ rows: [mockUpdatedUser] });

      const user = await userStore.updatePassword(userId, newHashedPassword);

      expect(user.id).toBe(userId);
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE"),
        [newHashedPassword, userId]
      );
    });

    test("should list users with filtering and pagination", async () => {
      const mockUsers = [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          email: "user1@example.com",
          roles: ["user"],
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
          last_password_changed_at: new Date(),
          metadata: {},
        },
        {
          id: "550e8400-e29b-41d4-a716-446655440001",
          email: "admin@example.com",
          roles: ["admin"],
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
          last_password_changed_at: new Date(),
          metadata: {},
        },
      ];

      mockPgPool.query
        .mockResolvedValueOnce({ rows: [{ count: "2" }] }) // count
        .mockResolvedValueOnce({ rows: mockUsers }); // users

      const result = await userStore.listUsers({
        limit: 10,
        offset: 0,
        roles: ["admin"],
        isActive: true,
      });

      expect(result.total).toBe(2);
      expect(result.users).toHaveLength(2);
      expect(result.users[1].email).toBe("admin@example.com");
    });

    test("should handle user not found errors", async () => {
      mockPgPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(userStore.updateUser("nonexistent-id", { roles: ["admin"] }))
        .rejects.toThrow(UserNotFoundError);
    });

    test("should create table with proper schema", async () => {
      mockPgPool.query.mockResolvedValueOnce({});

      await userStore.createTable();

      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS")
      );
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringMatching(/CREATE INDEX.*email/s)
      );
    });
  });

  describe("Database Adapter Integration Patterns", () => {
    test("should demonstrate MongoDB adapter usage pattern", () => {
      // This test documents the expected usage pattern
      const usageExample = `
        import { MongoClient } from "mongodb";
        import { MongoUserStore } from "@bluelibs/runner/auth/adapters";
        
        const client = new MongoClient("mongodb://localhost:27017");
        await client.connect();
        const db = client.db("myapp");
        
        const userStore = new MongoUserStore(db, "users");
        
        // Use with auth system
        globals.resources.auth.userStore.with({ store: userStore })
      `;

      expect(usageExample).toContain("MongoUserStore");
      expect(usageExample).toContain("globals.resources.auth.userStore.with");
    });

    test("should demonstrate PostgreSQL adapter usage pattern", () => {
      // This test documents the expected usage pattern
      const usageExample = `
        import { Pool } from "pg";
        import { PostgresUserStore } from "@bluelibs/runner/auth/adapters";
        
        const pool = new Pool({
          host: "localhost",
          port: 5432,
          database: "myapp",
          user: "postgres",
          password: "password",
        });
        
        const userStore = new PostgresUserStore(pool, "users");
        await userStore.createTable(); // Create table if it doesn't exist
        
        // Use with auth system
        globals.resources.auth.userStore.with({ store: userStore })
      `;

      expect(usageExample).toContain("PostgresUserStore");
      expect(usageExample).toContain("createTable");
      expect(usageExample).toContain("globals.resources.auth.userStore.with");
    });
  });
});