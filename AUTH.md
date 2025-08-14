# BlueLibs Runner Authentication System

The BlueLibs Runner Authentication System provides a complete, flexible authentication and authorization solution that follows the framework's patterns and principles.

## Quick Start

```typescript
import { resource, task, run, globals } from "@bluelibs/runner";
import { UserContext, authMiddleware, jwtMiddleware } from "@bluelibs/runner/auth";

// Basic auth setup
const app = resource({
  id: "app",
  register: [
    // Core auth resources
    globals.resources.auth.userStore,
    globals.resources.auth.passwordHasher,
    globals.resources.auth.jwtManager.with({
      jwtSecret: "your-secret-key",
      jwtExpiresIn: 24 * 60 * 60, // 24 hours
    }),
    
    // Auth tasks
    globals.tasks.auth.registerUser,
    globals.tasks.auth.authenticateUser,
  ],
  dependencies: {
    registerUser: globals.tasks.auth.registerUser,
    authenticateUser: globals.tasks.auth.authenticateUser,
  },
  init: async (_, { registerUser, authenticateUser }) => {
    // Register a user
    const registration = await registerUser({
      email: "user@example.com",
      password: "securepassword123",
      roles: ["user", "admin"],
    });
    
    // Authenticate the user
    const auth = await authenticateUser({
      email: "user@example.com",
      password: "securepassword123",
    });
    
    console.log(`User ${auth.user.email} authenticated with token: ${auth.token}`);
    
    return { user: auth.user, token: auth.token };
  },
});

await run(app);
```

## Core Features

### 🔐 User Management
- **Abstract Storage Interface**: Easy to integrate with any database
- **Memory Store**: Built-in implementation for development/testing
- **Secure Password Hashing**: PBKDF2-based password security
- **User Registration & Authentication**: Complete user lifecycle management

### 🎫 JWT Token System
- **Token Generation**: Secure JWT creation with configurable expiration
- **Token Validation**: Built-in verification with error handling
- **Middleware Integration**: Automatic token extraction and user context population

### 🛡️ Role-Based Access Control
- **Role Hierarchy**: Support for role inheritance (admin inherits user permissions)
- **Permission System**: Resource-based access control
- **Flexible Authorization**: Custom permission logic support

### 🔒 Middleware & Context
- **Authentication Middleware**: Protect tasks and resources
- **JWT Middleware**: Token extraction from headers, input, or context
- **User Context**: Request-scoped user data via AsyncLocalStorage
- **Helper Functions**: Convenient role checking utilities

## Architecture

The authentication system follows BlueLibs Runner patterns:

```
├── Resources (Singleton Services)
│   ├── userStore: Abstract user persistence
│   ├── passwordHasher: Secure password handling
│   ├── jwtManager: Token generation/validation
│   └── permissionChecker: Role-based authorization
│
├── Tasks (Business Logic)
│   ├── registerUser: User registration with validation
│   └── authenticateUser: Credential verification
│
├── Middleware (Cross-Cutting Concerns)
│   ├── authMiddleware: Authentication & authorization
│   └── jwtMiddleware: JWT token processing
│
└── Context (Request-Scoped Data)
    └── UserContext: Current user information
```

## Usage Examples

### Protected Tasks

```typescript
const protectedTask = task({
  id: "app.protected",
  middleware: [authMiddleware.with({ required: true })],
  run: async (input) => {
    const { user } = UserContext.use();
    return `Hello ${user.email}! You have roles: ${user.roles.join(", ")}`;
  },
});

const adminTask = task({
  id: "app.admin",
  middleware: [authMiddleware.with({ 
    roles: ["admin"], 
    roleCheck: "any" 
  })],
  run: async () => {
    const { user } = UserContext.use();
    return `Admin access granted for ${user.email}`;
  },
});
```

### JWT API Endpoints

```typescript
const apiEndpoint = task({
  id: "api.endpoint",
  middleware: [
    jwtMiddleware.with({ 
      tokenSource: "input",
      tokenProperty: "authorization" 
    })
  ],
  run: async (input: { authorization: string; data: any }) => {
    const { user } = UserContext.use();
    return {
      message: `API call successful for ${user.email}`,
      data: input.data,
      user: { id: user.id, email: user.email, roles: user.roles },
    };
  },
});

// Usage
const result = await apiEndpoint({
  authorization: jwtToken,
  data: { message: "Hello API!" },
});
```

### Express-like Header Integration

```typescript
const httpMiddleware = jwtMiddleware.with({
  tokenSource: "header",
  extractToken: (input) => {
    const authHeader = input?.headers?.authorization;
    return authHeader?.startsWith("Bearer ") 
      ? authHeader.substring(7) 
      : null;
  }
});

const httpTask = task({
  id: "http.handler",
  middleware: [httpMiddleware],
  run: async (input: { headers: any; body: any }) => {
    const { user } = UserContext.use();
    return { user, body: input.body };
  },
});
```

### Custom Database Integration

```typescript
import { IUserStore, IUser, IUserRegistration } from "@bluelibs/runner/auth";

class DatabaseUserStore implements IUserStore {
  constructor(private db: Database) {}
  
  async createUser(userData: IUserRegistration & { hashedPassword?: string }): Promise<IUser> {
    const result = await this.db.users.insert({
      email: userData.email,
      hashedPassword: userData.hashedPassword,
      roles: userData.roles || [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: userData.metadata || {},
    });
    
    return result;
  }
  
  async findByEmail(email: string): Promise<(IUser & { hashedPassword?: string }) | null> {
    return await this.db.users.findOne({ email });
  }
  
  // Implement other IUserStore methods...
}

// Use custom store
const app = resource({
  register: [
    globals.resources.auth.userStore.with({ 
      store: new DatabaseUserStore(myDatabase) 
    }),
    // ... other auth components
  ],
});
```

### Role Hierarchy & Permissions

```typescript
const customPermissions = resource({
  id: "app.permissions",
  register: [
    globals.resources.auth.permissionChecker.with({
      roleHierarchy: {
        "super_admin": ["admin", "user"],
        "admin": ["user"],
        "premium_user": ["user"],
      },
      permissions: {
        "user_management": ["admin", "super_admin"],
        "billing": ["admin", "super_admin"],
        "premium_features": ["premium_user", "admin", "super_admin"],
        "system_config": ["super_admin"],
      },
    }),
  ],
});
```

## Configuration Options

### JWT Manager Configuration

```typescript
globals.resources.auth.jwtManager.with({
  jwtSecret: "your-super-secret-key",
  jwtExpiresIn: 24 * 60 * 60, // 24 hours in seconds
})
```

### Authentication Middleware Options

```typescript
authMiddleware.with({
  required: true,                    // Require authentication
  roles: ["admin", "user"],         // Required roles (any or all)
  roleCheck: "any",                 // "any" or "all"
  authorize: (user) => user.isActive, // Custom authorization function
  unauthorizedMessage: "Login required",
  forbiddenMessage: "Access denied",
})
```

### JWT Middleware Options

```typescript
jwtMiddleware.with({
  tokenSource: "header",            // "header", "input", "context"
  tokenProperty: "token",           // Property name for input source
  refreshUser: false,               // Refresh user data from store
  extractToken: (input) => string, // Custom token extraction
})
```

## Error Handling

The auth system provides specific error types:

```typescript
import { 
  AuthenticationError,
  AuthorizationError,
  InvalidCredentialsError,
  UserAlreadyExistsError,
  InvalidTokenError,
} from "@bluelibs/runner/auth";

try {
  await authenticateUser({ email: "test@example.com", password: "wrong" });
} catch (error) {
  if (error instanceof InvalidCredentialsError) {
    console.log("Invalid email or password");
  } else if (error instanceof AuthenticationError) {
    console.log("Authentication failed:", error.message);
  }
}
```

## Testing

The auth system includes comprehensive test utilities:

```typescript
import { createTestResource } from "@bluelibs/runner";
import { MemoryUserStore } from "@bluelibs/runner/auth";

// Integration test
const testApp = createTestResource(yourApp, {
  overrides: [
    globals.resources.auth.userStore.with({ 
      store: new MemoryUserStore() 
    })
  ]
});

const { value: harness } = await run(testApp);

// Test user registration
const user = await harness.runTask(globals.tasks.auth.registerUser, {
  email: "test@example.com",
  password: "password123",
});

expect(user.user.email).toBe("test@example.com");
```

## Migration from Other Systems

### From Passport.js

```typescript
// Instead of Passport strategies, use the auth middleware
const googleAuthTask = task({
  id: "auth.google",
  middleware: [
    // Custom middleware to handle OAuth flow
    googleOAuthMiddleware,
    // Then populate user context
    authMiddleware.with({ required: true }),
  ],
  run: async (input) => {
    const { user } = UserContext.use();
    return { user, redirectUrl: "/dashboard" };
  },
});
```

### From Express Session

```typescript
// Instead of session middleware, use JWT middleware
const sessionTask = task({
  id: "api.session", 
  middleware: [
    jwtMiddleware.with({ tokenSource: "header" }),
    authMiddleware.with({ required: true }),
  ],
  run: async (input) => {
    const { user } = UserContext.use();
    // User is automatically available from JWT
    return { sessionData: user };
  },
});
```

## Security Best Practices

1. **Use Strong JWT Secrets**: Generate cryptographically secure secrets
2. **Set Appropriate Expiration**: Don't make tokens live forever
3. **Validate Input**: Use input schemas for all auth-related tasks
4. **Use HTTPS**: Always encrypt auth tokens in transit
5. **Implement Rate Limiting**: Protect against brute force attacks
6. **Log Security Events**: Monitor authentication failures
7. **Regular Token Rotation**: Implement refresh token mechanisms

## Performance Considerations

- **Memory Store**: Only for development; use database in production
- **JWT Verification**: Fast but scales with token frequency
- **Password Hashing**: Intentionally slow for security (PBKDF2)
- **Context Overhead**: Minimal AsyncLocalStorage performance impact
- **Middleware Chaining**: Very lightweight, ~0.01ms per middleware

The BlueLibs Runner authentication system provides enterprise-grade security while maintaining the framework's simplicity and flexibility. It's designed to handle everything from simple API authentication to complex multi-tenant applications with role hierarchies.