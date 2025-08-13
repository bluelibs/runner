# BlueLibs Runner: Dependency Injection Framework
BlueLibs Runner is a TypeScript-first dependency injection and task orchestration framework featuring Tasks, Resources, Events, and Middleware with functional programming principles.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap, Build, and Test
- **Install dependencies**: `npm install` -- takes ~2 minutes initially, ~30 seconds for updates. NEVER CANCEL.
- **Build**: `npm run build` -- takes <1 minute. NEVER CANCEL. Set timeout to 120+ seconds.
- **Run tests**: `npm test` -- takes ~13 seconds for 346 tests. NEVER CANCEL. Set timeout to 60+ seconds.
- **Test with coverage**: `npm run coverage` -- takes ~12 seconds. NEVER CANCEL. Set timeout to 60+ seconds.
- **Generate documentation**: `npm run typedoc` -- takes ~5 seconds. Creates docs in `./docs/`

### Development Workflow
- **TypeScript watch mode**: `npm run watch` -- monitors src/ for changes, recompiles automatically
- **Test watch mode**: `npm run test:dev` -- monitors tests, reruns on changes
- **Format code**: `npx prettier --write src` -- auto-formats all TypeScript files
- **Check formatting**: `npx prettier --check src` -- validates code formatting

### Known Limitations
- **ESLint**: Current ESLint config has compatibility issues with ESLint v9. Use Prettier for formatting instead.
- **Example app**: The express-mongo example has TypeScript dependency conflicts but core framework works perfectly.

## Validation Scenarios

### Always Test Core Functionality
After making changes, validate the framework works by running this test:
```javascript
// Create /tmp/test-validation.js
const { resource, task, event, run } = require('./dist/index');

const logger = resource({
  id: 'test.logger',
  init: async () => ({ info: (msg) => console.log(`[INFO] ${msg}`) })
});

const testEvent = event({ id: 'test.event' });

const testTask = task({
  id: 'test.task', 
  dependencies: { logger, testEvent },
  run: async (data, { logger, testEvent }) => {
    logger.info(`Processing: ${data.message}`);
    await testEvent({ processed: data.message });
    return { success: true };
  }
});

const app = resource({
  id: 'test.app',
  register: [logger, testEvent, testTask],
  dependencies: { testTask, logger },
  init: async (_, { testTask, logger }) => {
    const result = await testTask({ message: 'validation test' });
    logger.info('Validation successful');
    return result;
  }
});

run(app).then(({ dispose }) => {
  console.log('✅ Framework validation passed');
  dispose();
}).catch(console.error);
```
Run with: `node /tmp/test-validation.js`

### Always Test Middleware Functionality
Validate middleware chains work correctly:
```javascript
// Test middleware timing and error handling
const timingMiddleware = middleware({
  id: 'timing',
  run: async ({ task, next }) => {
    const start = Date.now();
    try {
      const result = await next(task.input);
      console.log(`Task completed in ${Date.now() - start}ms`);
      return result;
    } catch (error) {
      console.log(`Task failed after ${Date.now() - start}ms`);
      throw error;
    }
  }
});
```

## Architecture & Components

### Core Components
- **Tasks**: Functional business logic units with dependency injection
- **Resources**: Singleton services/connections with lifecycle management (init/dispose)
- **Events**: Async pub/sub communication system
- **Middleware**: Cross-cutting concerns (timing, auth, caching, retry)
- **Context**: Request-scoped data management via AsyncLocalStorage

### Built-in Features
- **Caching**: LRU cache with TTL via `globals.middleware.cache`
- **Retry**: Exponential backoff via `globals.middleware.retry`
- **Timeout**: Task timeouts via `globals.middleware.timeout`
- **Queue**: FIFO execution with deadlock detection
- **Semaphore**: Concurrency limiting for resource pools
- **Logging**: Structured event-driven logging system

### Key Patterns
- **Dependency Declaration**: `dependencies: { service1, service2 }`
- **Event Handling**: `on: eventDefinition` for automatic subscription
- **Middleware Chains**: `middleware: [auth, timing, cache]`
- **Configuration**: `resource.with({ config })` for parameterization
- **Testing**: Use `createTestResource()` for integration tests

## File Structure

### Repository Root
```
.
├── README.md              # Comprehensive documentation
├── package.json           # Dependencies & scripts  
├── tsconfig.json          # TypeScript configuration
├── jest.config.js         # Test configuration
├── .eslintrc.js          # ESLint config (has v9 compat issues)
├── .prettierrc.js        # Prettier formatting config
├── src/                  # Framework source code
├── examples/             # Example applications
├── dist/                 # Compiled JavaScript (after build)
└── docs/                 # Generated TypeDoc documentation
```

### Source Structure
```
src/
├── index.ts              # Main exports
├── define.ts             # Component definition helpers
├── run.ts                # Application runner
├── context.ts            # AsyncLocalStorage context system
├── models/               # Core framework classes
├── globals/              # Built-in resources & middleware
└── __tests__/            # Comprehensive test suite
```

## Common Tasks

### Creating Components
```typescript
// Task with dependencies
const userTask = task({
  id: 'app.tasks.createUser',
  dependencies: { database, logger },
  run: async (userData, { database, logger }) => {
    logger.info('Creating user');
    return await database.users.create(userData);
  }
});

// Resource with lifecycle
const database = resource({
  id: 'app.database',
  init: async (config) => {
    const client = new DatabaseClient(config.url);
    await client.connect();
    return client;
  },
  dispose: async (client) => await client.disconnect()
});

// Event definition
const userCreated = event<{ userId: string }>({
  id: 'app.events.userCreated'
});

// Event listener
const emailTask = task({
  id: 'app.tasks.sendWelcomeEmail',
  on: userCreated,
  run: async (event) => {
    await sendEmail(event.data.userId);
  }
});
```

### Running Applications
```typescript
const app = resource({
  id: 'app',
  register: [database, userTask, emailTask, userCreated],
  dependencies: { userTask },
  init: async (_, { userTask }) => {
    const user = await userTask({ name: 'Alice' });
    return { server: createServer() };
  }
});

const { value: appInstance, dispose } = await run(app);
// Use appInstance...
await dispose(); // Clean shutdown
```

### Testing Components
```typescript
// Unit test - mock dependencies
describe('userTask', () => {
  it('creates user', async () => {
    const mockDb = { users: { create: jest.fn() } };
    const result = await userTask.run(
      { name: 'Alice' },
      { database: mockDb, logger: mockLogger }
    );
    expect(mockDb.users.create).toHaveBeenCalled();
  });
});

// Integration test - full ecosystem
const testApp = createTestResource(app, {
  overrides: [mockDatabase]
});
const { value: harness } = await run(testApp);
const result = await harness.runTask(userTask, { name: 'Alice' });
```

## Debugging & Troubleshooting

### Common Issues
- **"Event not found"**: Ensure events are registered in the `register: []` array
- **Circular dependencies**: Check dependency chains, use function-based dependencies if needed
- **TypeScript errors**: Build fails indicate type issues; check dependency types
- **Memory leaks**: Always call `dispose()` to clean up resources

### Performance Notes
- **Task execution**: ~3ms for 500 iterations (very fast)
- **Middleware overhead**: Minimal, ~0.01ms per middleware
- **Memory usage**: Efficient, no leaks in test suite
- **Concurrency**: Use Semaphore for resource pool limiting

### Debugging Tools
- **Store inspection**: Access via `globals.resources.store` dependency
- **Event monitoring**: Listen to `globals.events.log` for all framework events
- **Task tracing**: Built-in beforeRun/afterRun/onError events for all tasks
- **Performance**: Use timing middleware for task duration measurement

## Best Practices
- Always register events, resources, and middleware before using them
- Use TypeScript for type safety and better developer experience
- Prefer composition over inheritance - combine small tasks
- Handle errors gracefully with try/catch or error events
- Test both unit (mocked) and integration (full ecosystem) scenarios
- Use `npm run watch` during development for auto-compilation
- Run `npm run coverage` before committing to ensure test quality
- Always dispose applications properly to prevent resource leaks