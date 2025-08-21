# Database Adapters Examples

This directory contains example implementations for integrating different databases with the BlueLibs Runner authentication system.

## Available Adapters

### MongoDB Adapter (`MongoUserStore.example.ts`)

A complete MongoDB integration that provides:
- Document-based user storage with BSON ObjectIds
- Automatic indexing for performance (email, roles, isActive, createdAt)  
- Full CRUD operations with proper error handling
- Support for metadata storage as nested documents
- Example connection and configuration setup

**Requirements:**
```bash
npm install mongodb @types/mongodb
```

**Usage:**
```typescript
import { MongoClient } from "mongodb";
import { MongoUserStore } from "./MongoUserStore.example";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();
const db = client.db("myapp");
const userStore = new MongoUserStore(db, "users");

// Register with auth system
globals.resources.auth.userStore.with({ store: userStore })
```

### PostgreSQL Adapter (`PostgresUserStore.example.ts`)

A complete PostgreSQL integration that provides:
- Relational user storage with UUID primary keys
- JSONB metadata storage for flexible user data
- Proper SQL indexing and performance optimization
- Full CRUD operations with parameterized queries
- Table creation and migration support

**Requirements:**
```bash
npm install pg @types/pg
```

**Usage:**
```typescript
import { Pool } from "pg";
import { PostgresUserStore } from "./PostgresUserStore.example";

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "myapp",
  user: "postgres",
  password: "password",
});

const userStore = new PostgresUserStore(pool, "users");
await userStore.createTable(); // Create table if needed

// Register with auth system
globals.resources.auth.userStore.with({ store: userStore })
```

## Integration with BlueLibs Runner

Both adapters implement the `IUserStore` interface and can be used as drop-in replacements for the default `MemoryUserStore`:

```typescript
import { resource, globals } from "@bluelibs/runner";

const app = resource({
  id: "app",
  register: [
    // Use your custom database adapter
    globals.resources.auth.userStore.with({ store: yourDatabaseStore }),
    
    // Register other auth components
    globals.resources.auth.passwordHasher,
    globals.resources.auth.jwtManager.with({
      jwtSecret: "your-secret-key",
      jwtExpiresIn: 24 * 60 * 60, // 24 hours
    }),
    globals.resources.auth.bruteForceProtection,
    globals.resources.auth.passwordResetService,
    globals.resources.auth.otpService,
  ],
  dependencies: {
    registerUser: globals.tasks.auth.registerUser,
    authenticateUser: globals.tasks.auth.authenticateUser,
  },
  init: async (_, { registerUser, authenticateUser }) => {
    // Your database is now integrated with the auth system
    const user = await registerUser({
      email: "user@example.com",
      password: "securepassword123",
      roles: ["user"],
    });
    
    return { success: true };
  },
});
```

## Features Supported

Both adapters provide full support for:

- ✅ **User Registration** - Create new users with validation
- ✅ **Authentication** - Login with email/password  
- ✅ **Password Updates** - Secure password changes with tracking
- ✅ **Role Management** - Flexible role-based access control
- ✅ **User Management** - CRUD operations for user accounts
- ✅ **Metadata Storage** - Custom user data and preferences
- ✅ **Performance Optimization** - Proper indexing and queries
- ✅ **Error Handling** - Comprehensive error types and messages
- ✅ **Type Safety** - Full TypeScript support

## Creating Custom Adapters

To create your own database adapter, implement the `IUserStore` interface:

```typescript
import { IUserStore, IUser, IUserRegistration } from "@bluelibs/runner/auth";

export class MyCustomUserStore implements IUserStore {
  async createUser(userData: IUserRegistration & { hashedPassword?: string }): Promise<IUser> {
    // Your implementation
  }
  
  async findByEmail(email: string): Promise<(IUser & { hashedPassword?: string }) | null> {
    // Your implementation
  }
  
  // ... implement all other required methods
}
```

The interface is well-documented with TypeScript types that guide implementation and ensure compatibility with the auth system.