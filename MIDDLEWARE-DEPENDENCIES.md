# Middleware Dependencies: Limitations and Best Practices

This document outlines the limitations and best practices for using dependencies in middleware, particularly focusing on circular dependency scenarios and global middleware behavior.

## Table of Contents

- [Overview](#overview)
- [Circular Dependency Detection](#circular-dependency-detection)
- [Global Middleware Dependencies](#global-middleware-dependencies)
- [Common Patterns and Limitations](#common-patterns-and-limitations)
- [Best Practices](#best-practices)
- [Error Messages and Debugging](#error-messages-and-debugging)

## Overview

BlueLibs Runner's dependency system supports complex middleware scenarios, including:
- Middleware with dependencies on resources and other middleware
- Global middleware that applies to all tasks or resources (`.everywhere()`)
- Dynamic function-based dependencies for handling forward references
- Configured middleware with conditional dependencies

However, certain patterns can create circular dependencies that the framework detects and prevents.

## Circular Dependency Detection

The framework performs comprehensive circular dependency analysis that includes:
- Direct dependencies between resources, tasks, and middleware
- Middleware attached to tasks and resources (both local and global)
- Function-based dependencies (resolved during registration)

### What Gets Checked

```typescript
// All of these are included in circular dependency analysis:

// 1. Direct dependencies
const serviceA = resource({
  dependencies: { serviceB }, // ✓ Checked
});

// 2. Middleware dependencies
const middleware = middleware({
  dependencies: { someService }, // ✓ Checked
});

// 3. Local middleware on tasks/resources
const task = task({
  middleware: [middleware], // ✓ Checked as dependency
  dependencies: { service }, // ✓ Checked
});

// 4. Global middleware
const globalMiddleware = middleware({
  dependencies: { service }, // ✓ Checked
}).everywhere();

// This creates implicit dependencies on ALL resources/tasks
```

## Global Middleware Dependencies

Global middleware (`.everywhere()`) creates special dependency scenarios:

### Automatic Dependency Injection

When middleware is made global, it's automatically included as a dependency for all applicable components:

```typescript
const logger = resource({
  id: 'logger',
  init: async () => ({ log: (msg: string) => console.log(msg) }),
});

const loggingMiddleware = middleware({
  id: 'logging',
  dependencies: { logger },
  run: async ({ next }, { logger }) => {
    logger.log('Middleware executing');
    return next();
  },
}).everywhere({ tasks: true, resources: false });

// This automatically makes ALL tasks depend on loggingMiddleware
// which in turn depends on logger
```

### Circular Dependencies with Global Middleware

**⚠️ Common Problem**: Global middleware depending on resources creates circular dependencies:

```typescript
// ❌ This will fail with CircularDependenciesError:
const service = resource({
  id: 'service',
  init: async () => 'service value',
});

const globalMiddleware = middleware({
  id: 'global.middleware',
  dependencies: { service }, // Depends on service
}).everywhere({ resources: true }); // Applied to ALL resources including service

const app = resource({
  register: [service, globalMiddleware],
  // ...
});

// Cycle: service -> global.middleware -> service
```

**✅ Solution**: Use events or extract shared dependencies:

```typescript
// Option 1: Use events for communication
const serviceInitialized = event({ id: 'service.initialized' });

const service = resource({
  id: 'service',
  on: serviceInitialized,
  init: async () => {
    const value = 'service value';
    await serviceInitialized({ value });
    return value;
  },
});

const globalMiddleware = middleware({
  id: 'global.middleware',
  dependencies: { serviceInitialized },
  run: async ({ next }, { serviceInitialized }) => {
    // Listen to events instead of direct dependency
    return next();
  },
}).everywhere({ resources: false, tasks: true });

// Option 2: Extract shared dependencies
const sharedConfig = resource({
  id: 'shared.config',
  init: async () => ({ setting: 'value' }),
});

const service = resource({
  id: 'service',
  dependencies: { sharedConfig },
  init: async (_, { sharedConfig }) => `service with ${sharedConfig.setting}`,
});

const globalMiddleware = middleware({
  id: 'global.middleware',
  dependencies: { sharedConfig }, // Both depend on shared resource
  run: async ({ next }, { sharedConfig }) => {
    console.log('Config:', sharedConfig.setting);
    return next();
  },
}).everywhere({ tasks: true, resources: false });
```

## Common Patterns and Limitations

### 1. Middleware Depending on Resources Using Same Middleware

```typescript
// ❌ Circular dependency:
const database = resource({
  id: 'database',
  middleware: [authMiddleware], // Uses auth middleware
  init: async () => new Database(),
});

const authMiddleware = middleware({
  id: 'auth',
  dependencies: { database }, // Depends on database
  run: async ({ next }, { database }) => {
    // Check auth in database
    return next();
  },
});

// Cycle: database -> authMiddleware -> database
```

### 2. Nested Middleware Dependencies

```typescript
// ❌ Circular dependency:
const middlewareA = middleware({
  id: 'middleware.a',
  dependencies: () => ({ middlewareB }), // Forward reference
  run: async ({ next }, { middlewareB }) => next(),
});

const middlewareB = middleware({
  id: 'middleware.b',
  dependencies: () => ({ middlewareA }), // Circular reference
  run: async ({ next }, { middlewareA }) => next(),
});

// Cycle: middlewareA -> middlewareB -> middlewareA
```

### 3. Function-Based Dependencies with Forward References

```typescript
// ✅ This works (forward reference without cycle):
const serviceA = resource({
  id: 'service.a',
  init: async () => 'Service A',
});

const middlewareA = middleware({
  id: 'middleware.a',
  dependencies: () => ({ serviceB }), // Forward reference
  run: async ({ next }, { serviceB }) => `A[${serviceB}]: ${await next()}`,
});

const serviceB = resource({
  id: 'service.b',
  dependencies: { serviceA },
  // No circular dependency here
  init: async (_, { serviceA }) => `Service B with ${serviceA}`,
});
```

## Best Practices

### 1. Design Patterns to Avoid Circular Dependencies

**Use Dependency Inversion**:
```typescript
// Instead of middleware depending directly on resources it applies to,
// extract interfaces or use events

// ❌ Direct dependency
const authMiddleware = middleware({
  dependencies: { userService }, // userService might use this middleware
});

// ✅ Event-based communication
const userLoggedIn = event({ id: 'user.logged.in' });

const authMiddleware = middleware({
  dependencies: { userLoggedIn },
  run: async ({ next }, { userLoggedIn }) => {
    // Listen for events instead of direct resource access
    return next();
  },
});
```

**Extract Shared Dependencies**:
```typescript
// ✅ Both middleware and resource depend on shared service
const configService = resource({
  id: 'config',
  init: async () => ({ authEnabled: true }),
});

const userService = resource({
  dependencies: { configService },
  // ...
});

const authMiddleware = middleware({
  dependencies: { configService }, // Shared dependency
  // ...
});
```

### 2. Global Middleware Best Practices

**Limit Global Middleware Dependencies**:
```typescript
// ✅ Global middleware with minimal dependencies
const timingMiddleware = middleware({
  id: 'timing',
  run: async ({ next }) => {
    const start = Date.now();
    const result = await next();
    console.log(`Execution time: ${Date.now() - start}ms`);
    return result;
  },
}).everywhere();

// ✅ Global middleware with carefully chosen dependencies
const contextMiddleware = middleware({
  id: 'context',
  dependencies: { logger }, // logger doesn't use middleware
  run: async ({ next }, { logger }) => {
    logger.log('Context middleware executing');
    return next();
  },
}).everywhere({ tasks: true, resources: false });
```

### 3. Use Function-Based Dependencies for Complex Cases

```typescript
// ✅ Function-based dependencies for conditional logic
const conditionalMiddleware = middleware({
  id: 'conditional',
  dependencies: (config: { useDatabase: boolean }) => 
    config.useDatabase ? { database } : {},
  run: async ({ next }, deps, config) => {
    if (config.useDatabase && deps.database) {
      // Use database
    }
    return next();
  },
});
```

## Error Messages and Debugging

### Understanding Circular Dependency Errors

When a circular dependency is detected, you'll see an error like:

```
CircularDependenciesError: Circular dependencies detected:
  • task.auth -> middleware.auth -> service.user -> task.auth

To resolve circular dependencies:
  • Use function-based dependencies: () => ({ dependency })
  • Consider refactoring to reduce coupling between components
  • Extract shared dependencies into separate resources
  • For middleware: avoid depending on resources that use the same middleware
  • Consider using events for communication instead of direct dependencies
```

### Debugging Tips

1. **Identify the cycle**: Look at the dependency chain in the error message
2. **Find the problematic link**: Usually involves middleware depending on resources that use the same middleware
3. **Use events**: Replace direct dependencies with event-based communication
4. **Extract shared concerns**: Move common dependencies to separate resources
5. **Review global middleware**: Check if global middleware is creating unexpected dependencies

### Common Scenarios and Solutions

| Scenario | Problem | Solution |
|----------|---------|----------|
| Global middleware + resource dependency | `global.middleware -> service -> global.middleware` | Use events or exclude from global application |
| Middleware chain cycles | `middlewareA -> middlewareB -> middlewareA` | Redesign middleware responsibilities |
| Resource-middleware cycles | `resource -> middleware -> resource` | Extract shared dependencies |
| Forward reference issues | Function dependencies resolving incorrectly | Ensure all referenced components are defined |

## Performance Considerations

- **Circular dependency checking**: Runs once during initialization with minimal overhead
- **Function-based dependencies**: Resolved once during registration, no runtime cost
- **Global middleware**: Applied efficiently during task/resource execution
- **Memory usage**: Dependency graph is temporary and cleaned up after validation

## Conclusion

While BlueLibs Runner's middleware dependency system is powerful and flexible, understanding these limitations helps you design better architectures that avoid circular dependencies. The key is to:

1. Keep middleware dependencies minimal and focused
2. Use events for cross-cutting concerns
3. Extract shared dependencies into separate resources
4. Be cautious with global middleware dependencies
5. Leverage function-based dependencies for complex scenarios

The framework's comprehensive circular dependency detection ensures that these issues are caught early, preventing runtime problems and helping you build more maintainable applications.