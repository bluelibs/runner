# Express OpenAPI SQLite Example

```bash
git clone git@github.com:bluelibs/runner.git
cd runner
npm install
npm run build
npm run benchmark # if you're brave enough, post results

# Doing it like this because the example requires file-based runner to be able to keep examples working with any change
cd ./examples/express-openapi-sqlite
npm install
PORT=31337 npm run dev
PORT=31337 npm run test # (integration tests)
```

A complete Express.js application demonstrating current Runner composition patterns with:

- **Custom tags (`httpTag`)** for route metadata and discovery
- **Hook-driven route registration** using `r.hook(...).on(events.ready)`
- **Authentication** with task middleware and JWT
- **SQLite database** with user management
- **Async context** for request-scoped data using `r.asyncContext()`
- **OpenAPI/Swagger** generation from task metadata
- **Comprehensive integration tests**

## Features Demonstrated

The full power and simplicity of Runner.

### 1. Custom Tags System

```typescript
const registerUserTask = r
  .task("register")
  .dependencies({ appConfig, createUserTask })
  .tags([
    httpRoute.post("/api/auth/register", {
      summary: "Register a new user",
      requiresAuth: false,
      requestBodySchema: registerSchema,
      responseSchema: registerResponseSchema,
    }),
  ])
  .inputSchema(registerSchema)
  .run(async (userData, { appConfig, createUserTask }) => {
    const user = await createUserTask(userData);
    // Generate token and return typed API response
    return { success: true, data: { user } };
  })
  .build();
```

### 2. Hook-Driven Route Registration

```typescript
export const routeRegistrationHook = r
  .hook("routeRegistration")
  .on(events.ready)
  .dependencies({
    httpTag: httpTag.startup(),
    taskRunner: resources.taskRunner,
    expressServer: expressServerResource,
  })
  .run(async (_, { httpTag, taskRunner, expressServer }) => {
    // Discover tagged tasks at startup and register Express handlers
  })
  .build();
```

### 3. Async Context

```typescript
export const RequestContext = r
  .asyncContext<RequestData>("request")
  .build();

// Used to provide request-scoped data before running a task
await RequestContext.provide(requestData, () =>
  taskRunner.run(task, taskInput),
);
```

### 4. Middleware Integration

```typescript
export const authMiddleware = r.middleware
  .task<AuthMiddlewareConfig>("auth")
  .dependencies({ userService: usersRepository, appConfig })
  .run(async ({ task, next }, { userService, appConfig }, config) => {
    // JWT verification and user async-context setup
    return UserContext.provide(userSession, () => next(task?.input));
  })
  .build();
```

## Quick Start

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Start the development server:**

   ```bash
   npm run dev
   ```

3. **Test the API:**

   ```bash
   # Register a user
   curl -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"password123","name":"Test User"}'

   # Login
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"password123"}'

   # Access protected route
   curl -X GET http://localhost:3000/api/auth/profile \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

4. **View API documentation:**
   Visit `http://localhost:3000/api-docs`

5. **Run tests:**
   ```bash
   npm test
   ```

## API Endpoints

| Method | Endpoint             | Description       | Auth Required |
| ------ | -------------------- | ----------------- | ------------- |
| GET    | `/health`            | Health check      | No            |
| POST   | `/api/auth/register` | Register new user | No            |
| POST   | `/api/auth/login`    | User login        | No            |
| GET    | `/api/auth/profile`  | Get user profile  | Yes           |
| GET    | `/api/users`         | Get all users     | Yes           |

## Key Components

### Resources

- **App resource**: Registers config, database, HTTP, and users modules under one root
- **Database resource**: SQLite database with user table
- **Users repository resource**: User CRUD operations
- **Express server resource**: HTTP server lifecycle management

### Tasks

- **Register User Task**: User registration with validation
- **Login User Task**: Authentication with JWT
- **Get User Profile Task**: Protected user data retrieval
- **Get All Users Task**: Admin endpoint for user listing

### Middleware

- **Auth task middleware**: JWT verification and user context setup

### Hooks

- **Route registration hook**: Scans `httpTag` entries on `events.ready` and wires Express routes + OpenAPI docs

### Tags

- **HTTP tag**: Route decoration with method, path, and OpenAPI metadata

## Framework Features Showcased

1. **Dependency Injection**: All components declare their dependencies clearly
2. **Resource Lifecycle**: Proper initialization and disposal
3. **Hooks and events**: Automatic route registration on `events.ready`
4. **Async context**: Request-scoped user and request data
5. **Middleware Chains**: Authentication and validation layers
6. **Input Validation**: Schema validation using Match
7. **Error Handling**: Comprehensive error responses
8. **Testing**: Full integration test suite

## Environment Variables

- `JWT_SECRET`: Secret key for JWT tokens (defaults to 'your-secret-key')
- `PORT` The port used by express to open the HTTP Server

## Database

The application uses SQLite with a simple user table:

- In-memory database for tests
- File-based database (`data.db`) for development

## Testing

The integration tests demonstrate the complete authentication flow:

- User registration
- User login
- Protected route access
- Input validation
- Error handling

Run tests with:

```bash
npm test
```

## Architecture Benefits

This example showcases how Runner enables:

1. **Separation of Concerns**: Business logic in tasks, infrastructure in resources
2. **Declarative Configuration**: Route definitions as metadata tags
3. **Type Safety**: Full TypeScript support throughout the resource graph
4. **Testability**: Easy to mock dependencies and test components
5. **Maintainability**: Clear component boundaries and dependencies
6. **Scalability**: Easy to add new endpoints and middleware
