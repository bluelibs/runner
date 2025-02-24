# Environment Variables

The BlueLibs Runner framework provides a powerful environment variable management system through the `env` resource. This allows you to access environment variables in a type-safe manner, with support for default values, type casting, and custom parsers.

## Basic Usage

You can use the environment resource in your tasks and resources by importing it from the runner package:

```typescript
import { task, env } from "@bluelibs/runner";

const myTask = task({
  id: "app.myTask",
  dependencies: {
    env,
  },
  async run(_, { env }) {
    // Get an environment variable with a default value
    const port = env.get("PORT", 3000);
    
    // Set an environment variable with type casting
    env.set("DEBUG", { defaultValue: "false", cast: "boolean" });
    
    if (env.get("DEBUG")) {
      console.log("Debug mode enabled");
    }
    
    return { port };
  },
});
```

## Setting Environment Variables

The `set` method allows you to define environment variables with optional casting and default values:

```typescript
// Signature
env.set<T>(key: string, options: { defaultValue?: T, cast?: EnvCastType }): T;
```

When you call `set`, it:

1. Checks if the variable exists in `process.env`
2. Falls back to the provided default value if not found
3. Applies type casting if specified
4. Stores the result in the environment manager

Example:

```typescript
// Set with a default value
const url = env.set("DATABASE_URL", { 
  defaultValue: "mongodb://localhost:27017/myapp"
});

// Set with type casting
const port = env.set("PORT", { 
  defaultValue: "3000", 
  cast: "number" 
}); // port will be the number 3000

// Both process.env value and casting
// If process.env.DEBUG is "true", this will be `true` (boolean)
const debug = env.set("DEBUG", { 
  defaultValue: "false", 
  cast: "boolean" 
});
```

## Getting Environment Variables

The `get` method retrieves previously set environment variables:

```typescript
// Signature
env.get<T>(key: string, defaultValue?: T): T;
```

When you call `get`, it:
1. Returns the value from the environment store if already set
2. If not in the store but exists in `process.env`, it loads it from there
3. Falls back to the provided default value if not found anywhere

Example:

```typescript
// Get a previously set variable
const debug = env.get("DEBUG"); // boolean value

// Get with a default value if not set
const timeout = env.get("TIMEOUT", 5000); // 5000 if not defined
```

## Type Casting

The environment manager supports several built-in cast types:

| Cast Type | Description | Example |
|-----------|-------------|---------|
| `string`  | Keeps the value as a string (default) | `"3000"` → `"3000"` |
| `number`  | Converts to a number using `parseFloat` | `"3000"` → `3000` |
| `boolean` | Converts to a boolean, evaluating falsy values | `"false"` → `false` |
| `date`    | Converts to a Date object | `"2023-01-01"` → `Date` |

The boolean cast type considers the following string values as `false`:
- `""` (empty string)
- `"0"`
- `"false"`
- `"no"`
- `"undefined"`
- `"null"`

Any other value is considered `true`.

## Custom Cast Handlers

You can add your own custom casting functions for special use cases:

```typescript
// Add a custom JSON parser
env.addCastHandler("json", value => JSON.parse(value));

// Use the custom handler
const config = env.set("APP_CONFIG", { 
  defaultValue: '{"logLevel":"info","maxConnections":100}', 
  cast: "json"
});
// config is now an object: { logLevel: "info", maxConnections: 100 }

// Add a handler for comma-separated lists
env.addCastHandler("array", value => value.split(",").map(v => v.trim()));

// Use the array handler
const tags = env.set("TAGS", { 
  defaultValue: "tag1,tag2,tag3", 
  cast: "array"
});
// tags is now: ["tag1", "tag2", "tag3"]
```

## Type Safety with TypeScript

You can extend the environment variable types using TypeScript declaration merging:

```typescript
// Extend the environment variables with custom interfaces
declare module "@bluelibs/runner" {
  namespace EnvVars {
    interface IEnvironment {
      DATABASE_URL: string;
      PORT: number;
      DEBUG: boolean;
      API_KEYS: string[];
    }
  }
}
```

This allows you to get better type completion and type checking when using environment variables in your application.

## Accessing All Environment Variables

You can get all environment variables that have been set in the manager:

```typescript
const allVars = env.getAll();
console.log("All environment variables:", allVars);
```

## Best Practices

1. **Set variables early**: Initialize all environment variables at the start of your application
2. **Use casting**: Leverage type casting to ensure variables have the correct type
3. **Provide defaults**: Always provide sensible default values for non-critical variables
4. **Extend types**: Use TypeScript's declaration merging to create a type-safe environment interface
5. **Group related variables**: Consider organizing related environment variables using a naming convention

## Example

Here's a complete example showing how to use the environment resource in a real application:

```typescript
import { task, resource, env, run } from "@bluelibs/runner";

// Type definitions
declare module "@bluelibs/runner" {
  namespace EnvVars {
    interface IEnvironment {
      PORT: number;
      DATABASE_URL: string;
      LOG_LEVEL: "debug" | "info" | "warn" | "error";
      FEATURE_FLAGS: Record<string, boolean>;
    }
  }
}

// Environment setup task
const setupEnvTask = task({
  id: "app.tasks.setupEnv",
  dependencies: {
    env,
  },
  async run(_, { env }) {
    // Basic settings
    env.set("PORT", { defaultValue: "3000", cast: "number" });
    env.set("DATABASE_URL", { 
      defaultValue: "mongodb://localhost:27017/myapp" 
    });
    env.set("LOG_LEVEL", { defaultValue: "info" });
    
    // Custom cast handler for feature flags
    env.addCastHandler("json", value => JSON.parse(value));
    env.set("FEATURE_FLAGS", { 
      defaultValue: '{"newUI":false,"betaFeatures":false}', 
      cast: "json" 
    });
    
    return {
      port: env.get("PORT"),
      databaseUrl: env.get("DATABASE_URL"),
      logLevel: env.get("LOG_LEVEL"),
      featureFlags: env.get("FEATURE_FLAGS"),
    };
  },
});

// Server task
const serverTask = task({
  id: "app.tasks.startServer",
  dependencies: {
    env,
    setupEnv: setupEnvTask,
  },
  async run(_, { env, setupEnv }) {
    // Wait for environment to be set up
    const config = await setupEnv();
    
    console.log(`Starting server on port ${config.port}`);
    console.log(`Connected to database at ${config.databaseUrl}`);
    console.log(`Log level set to ${config.logLevel}`);
    
    if (config.featureFlags.newUI) {
      console.log("New UI enabled");
    }
    
    // Start your server here...
    
    return { status: "running", config };
  },
});

// Main app resource
const app = resource({
  id: "app",
  register: [env, setupEnvTask, serverTask],
  dependencies: {
    serverTask,
  },
  async init(_, { serverTask }) {
    return serverTask();
  },
});

// Run the application
run(app).then(result => {
  console.log("Application running:", result);
}).catch(err => {
  console.error("Failed to start application:", err);
});
```