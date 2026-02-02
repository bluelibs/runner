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

A complete Express.js application demonstrating the full power of BlueLibs Runner with:

- **Custom Tags (httpTag)** for route decoration
- **Event-driven Architecture** using `afterInit` for automatic route registration
- **Authentication** with Passport and JWT
- **SQLite Database** with user management
- **Context System** for request-scoped data using `createContext()`
- **OpenAPI/Swagger** documentation
- **Comprehensive Integration Tests**

## Features Demonstrated

The full power and simplicity of Runner.

### 1. Custom Tags System

```typescript
// HTTP tag for marking tasks as endpoints
const registerUserTask = task({
  id: "app.tasks.auth.register",
  tags: [
    httpRoute.post("/api/auth/register", {
      summary: "Register a new user",
      requiresAuth: false,
      requestBodySchema: registerSchema,
    }),
  ],
  run: async (userData) => {
    // Enforces API response because of the presence of the tag
    /* ... */
  },
});
```

### 2. Event-Driven Route Registration

```typescript
// Listens to afterInit event to scan and register routes
export const routeRegistrationTask = hook({
  id: "app.tasks.routeRegistration",
  on: globals.events.ready,
  run: async () => {
    // Automatically discovers tasks with HTTP tags
    // and registers them as Express routes
  },
});
```

### 3. Context System

```typescript
// User context for request-scoped data
export const UserContext = createContext<UserSession>("user.session");

// Used in middleware and tasks
const userSession = UserContext.use();
```

### 4. Middleware Integration

```typescript
export const authMiddleware = defineMiddleware<AuthConfig>({
  id: "app.middleware.auth",
  run: async ({ task, next }, deps, config) => {
    // JWT verification and user context setup
    if (task) {
      return UserContext.provide(userSession, () => next(task.input));
    }
  },
});
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

- **Database Resource**: SQLite database with user table
- **User Service Resource**: User CRUD operations
- **Express Server Resource**: HTTP server lifecycle management
- **HTTP Route Bridge Resource**: Connects Express routes to Runner tasks

### Tasks

- **Register User Task**: User registration with validation
- **Login User Task**: Authentication with JWT
- **Get User Profile Task**: Protected user data retrieval
- **Get All Users Task**: Admin endpoint for user listing

### Middleware

- **Auth Middleware**: JWT verification and user context setup

### Tags

- **HTTP Tag**: Route decoration with method, path, OpenAPI specs

## Framework Features Showcased

1. **Dependency Injection**: All components declare their dependencies clearly
2. **Resource Lifecycle**: Proper initialization and disposal
3. **Event System**: Automatic route registration on `afterInit`
4. **Context Management**: Request-scoped user and request data
5. **Middleware Chains**: Authentication and validation layers
6. **Input Validation**: Schema validation using Zod
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

This example showcases how BlueLibs Runner enables:

1. **Separation of Concerns**: Business logic in tasks, infrastructure in resources
2. **Declarative Configuration**: Route definitions as metadata tags
3. **Type Safety**: Full TypeScript support throughout
4. **Testability**: Easy to mock dependencies and test components
5. **Maintainability**: Clear component boundaries and dependencies
6. **Scalability**: Easy to add new endpoints and middleware
