export const codeExamples = {
  tasksQuickStart: `import { resource, task, run } from "@bluelibs/runner";

const hello = task({
  id: "app.tasks.hello",
  run: async (name: string) => "Hello, " + name + "!",
});

const app = resource({
  id: "app",
  // Registration makes the task discoverable & interceptable
  register: [hello],
  // This is how you let the system know about all other core components.
});

(async () => {
  const { runTask, dispose } = await run(app);
  const result = await runTask(hello, "Runner"); // "Hello, Runner!"
  await dispose();
})();`,
  tasks: `const sendEmail = task({
  id: "app.tasks.sendEmail",
  dependencies: { emailService, logger },
  run: async ({ to, subject, body }: EmailData, { emailService, logger }) => {
    await logger.info(\`Sending email to \${to}\`);
    return await emailService.send({ to, subject, body });
  },
});

// Test it like a normal function (because it basically is)
const result = await sendEmail.run(
  { to: "user@example.com", subject: "Hi", body: "Hello!" },
  { emailService: mockEmailService, logger: mockLogger },
);`,

  resources: `const database = resource({
  id: "app.db",
  init: async () => {
    const client = new MongoClient(process.env.DATABASE_URL as string);
    await client.connect();

    return client;
  },
  dispose: async (client) => await client.close(),
});

const userService = resource({
  id: "app.services.user",
  dependencies: { database },
  init: async (_, { database }) => ({
    async createUser(userData: UserData) {
      return database.collection("users").insertOne(userData);
    },
    async getUser(id: string) {
      return database.collection("users").findOne({ _id: id });
    },
  }),
});`,

  resourceConfig: `type SMTPConfig = {
  smtpUrl: string;
  from: string;
};

const emailer = resource({
  id: "app.emailer",
  init: async (config: SMTPConfig) => ({
    send: async (to: string, subject: string, body: string) => {
      // Use config.smtpUrl and config.from
    },
  }),
});

// Register with specific config
const app = resource({
  id: "app",
  register: [
    emailer.with({
      smtpUrl: "smtp://localhost",
      from: "noreply@myapp.com",
    }),
  ],
});`,

  events: `const userRegistered = event<{ userId: string; email: string }>({
  id: "app.events.userRegistered",
});

const registerUser = task({
  id: "app.tasks.registerUser",
  dependencies: { userService, userRegistered },
  run: async (userData, { userService, userRegistered }) => {
    const user = await userService.createUser(userData);

    // Tell the world about it
    await userRegistered({ userId: user.id, email: user.email });
    return user;
  },
});`,

  hooks: `import { hook } from "@bluelibs/runner";

const sendWelcomeEmail = hook({
  id: "app.hooks.sendWelcomeEmail",
  on: userRegistered, // Listen to the event
  run: async (eventData) => {
    // Everything is type-safe, automatically inferred from the 'on' property
    console.log(\`Welcome email sent to \${eventData.data.email}\`);
  },
});`,

  middleware: `import { taskMiddleware } from "@bluelibs/runner";

// Task middleware with config
type AuthMiddlewareConfig = { requiredRole: string };
const authMiddleware = taskMiddleware<AuthMiddlewareConfig>({
  id: "app.middleware.task.auth",
  run: async ({ task, next }, _deps, config) => {
    // Must return the value
    return await next(task.input);
  },
});

const adminTask = task({
  id: "app.tasks.adminOnly",
  middleware: [authMiddleware.with({ requiredRole: "admin" })],
  run: async (input: { user: User }) => "Secret admin data",
});`,

  context: `const UserContext = createContext<{ userId: string; role: string }>
("app.userContext");

const getUserData = task({
  id: "app.tasks.getUserData",
  middleware: [UserContext.require()], // This is a middleware that ensures the context is available before task runs, throws if not.
  run: async () => {
    const user = UserContext.use(); // Available anywhere in the async chain
    return \`Current user: \${user.userId} (\${user.role})\`;
  },
});

// Provide context at the entry point
const handleRequest = resource({
  id: "app.requestHandler",
  init: async () => {
    return UserContext.provide({ userId: "123", role: "admin" }, async () => {
      // All tasks called within this scope have access to UserContext
      return await getUserData();
    });
  },
});`,

  interceptors: `import { task, resource, run } from "@bluelibs/runner";

const calculatorTask = task({
  id: "app.tasks.calculator",
  run: async (input: { value: number }) => {
    console.log("3. Task is running...");
    return { result: input.value + 1 };
  },
});

const interceptorResource = resource({
  id: "app.interceptor",
  dependencies: {
    calculatorTask,
  },
  init: async (_, { calculatorTask }) => {
    // Intercept the task to modify its behavior
    calculatorTask.intercept(async (next, input) => {
      console.log("1. Interceptor before task run");
      const result = await next(input);
      console.log("4. Interceptor after task run");
      return { ...result, intercepted: true };
    });
  },
});`,

  optionalDeps: `const emailService = resource({
  id: "app.services.email",
  init: async () => new EmailService(),
});

const userRegistration = task({
  id: "app.tasks.registerUser",
  dependencies: {
    database: userDatabase, // Required
    emailService: emailService.optional(), // Optional
  },
  run: async (userData, { database, emailService }) => {
    const user = await database.users.create(userData);

    if (emailService) {
      await emailService.sendWelcome(user.email);
    }

    return user;
  },
});`,

  logging: `import { resource, globals } from "@bluelibs/runner";

const app = resource({
  id: "app",
  dependencies: {
    logger: globals.resources.logger,
  },
  init: async (_, { logger }) => {
    logger.info("Starting business process");
    logger.warn("This might take a while");
    logger.error("Oops, something went wrong", {
      error: new Error("Database connection failed"),
    });
  },
})

run(app, {
  logs: {
    printThreshold: "info",
    printStrategy: "pretty",
  },
});`,

  caching: `import { globals } from "@bluelibs/runner";

const expensiveTask = task({
  id: "app.tasks.expensive",
  middleware: [
    globals.middleware.task.cache.with({
      ttl: 60 * 1000, // Cache for 1 minute
      keyBuilder: (taskId, input) => \`\${taskId}-\${input.userId}\`,
    }),
  ],
  run: async ({ userId }) => {
    return await doExpensiveCalculation(userId);
  },
});`,

  cachingOverride: `import { task } from "@bluelibs/runner";

const redisCacheFactory = task({
  id: "globals.tasks.cacheFactory", // Same ID as the default task
  run: async (options: any) => {
    return new RedisCache(options);
  },
});

const app = resource({
  id: "app",
  register: [globals.resources.cache],
  overrides: [redisCacheFactory], // Override the default cache factory
});`,

  retries: `import { globals } from "@bluelibs/runner";

const flakyApiCall = task({
  id: "app.tasks.flakyApiCall",
  middleware: [
    globals.middleware.task.retry.with({
      retries: 5, // Try up to 5 times
      delayStrategy: (attempt) => 100 * Math.pow(2, attempt), // Exponential backoff
      stopRetryIf: (error) => error.message === "Invalid credentials",
    }),
  ],
  run: async () => {
    return await fetchFromUnreliableService();
  },
});`,

  timeouts: `import { globals } from "@bluelibs/runner";

const apiTask = task({
  id: "app.tasks.externalApi",
  middleware: [
    globals.middleware.task.timeout.with({ ttl: 5000 }), // 5 second timeout
  ],
  run: async () => {
    return await fetch("https://slow-api.example.com/data");
  },
});`,

  runOptions: `const { dispose, getResourceValue, runTask, emitEvent } = await run(app);

// Or with debug logging enabled
const { dispose } = await run(app, { debug: "verbose" });

// CI validation (no side effects):
await run(app, { dryRun: true });`,

  shutdown: `const databaseResource = resource({
  id: "app.database",
  init: async () => {
    const connection = await connectToDatabase();
    console.log("Database connected");
    return connection;
  },
  dispose: async (connection) => {
    await connection.close();
    console.log("Database connection closed");
  },
});`,

  unhandledErrors: `await run(app, {
  errorBoundary: true,
  onUnhandledError: async ({ error, kind, source }) => {
    await telemetry.capture(error as Error, { kind, source });
    if (kind === "process") {
      process.exit(1);
    }
  },
});`,

  debugResource: `run(app, { debug: "verbose" });`,

  metaAndTags: `import { tag } from "@bluelibs/runner";

const performanceTag = tag<{ alertAboveMs: number }> ({
  id: "performance.monitoring",
});

const expensiveTask = task({
  id: "app.tasks.expensiveCalculation",
  tags: [
    performanceTag.with({
      alertAboveMs: 5000,
    }),
  ],
  run: async (input) => {
    // Heavy computation here
  },
});`,

  overrides: `import { resource, override, run } from "@bluelibs/runner";

const emailer = resource({
  id: "app.emailer",
  init: async () => ({ send: async () => "smtp" }),
});

// Keep the same id, change behavior; nearest to run() wins
const testEmailer = override(emailer, {
  init: async () => ({ send: async () => "mock" }),
});

const app = resource({
  id: "app",
  register: [emailer],
  overrides: [testEmailer],
});

const rr = await run(app);
const svc = rr.getResourceValue(emailer);
await svc.send(); // -> "mock"
await rr.dispose();`,

  testing: `import { resource, run, override } from "@bluelibs/runner";

// App under test
const app = resource({ id: "app", register: [/* tasks/resources */] });

// Optional: apply test doubles via overrides
// const mockRes = override(realRes, { init: async () => mock });
// const harness = resource({ id: "test", register: [app], overrides: [mockRes] });

const rr = await run(app /* or harness */);
await rr.runTask(someTask, { x: 1 });
await rr.emitEvent(someEvent, { id: "e1" });
const value = rr.getResourceValue(someResource);
await rr.dispose();`,

  // Middleware – extended samples
  middlewareTaskAuth: `import { task, taskMiddleware } from "@bluelibs/runner";

type User = { id: string; role: "user" | "admin" };

// Task middleware with typed config, input, output
const requireRole = taskMiddleware<
  { role: User["role"] },
  { user: User },
  { user: User & { verified: true } }
>({
  id: "app.middleware.task.requireRole",
  run: async ({ task, next }, _deps, cfg) => {
    if (task.input.user.role !== cfg.role) {
      throw new Error("Unauthorized");
    }
    const result = await next(task.input);
    return { user: { ...task.input.user, verified: true } };
  },
});

export const getSecret = task({
  id: "app.tasks.getSecret",
  middleware: [requireRole.with({ role: "admin" })],
  run: async (input: { user: User }) => ({ secret: "xyz" }),
});`,

  middlewareResilientTask: `import { task, globals } from "@bluelibs/runner";

const resilientTask = task({
  id: "app.tasks.resilient",
  middleware: [
    globals.middleware.task.retry.with({
      retries: 3,
      delayStrategy: (attempt) => 250 * attempt,
      stopRetryIf: (err) => err?.permanent === true,
    }),
    globals.middleware.task.timeout.with({ ttl: 10_000 }),
    globals.middleware.task.cache.with({ ttl: 60_000 }),
  ],
  run: async (input: { id: string }) => fetchExpensive(input.id),
});`,

  middlewareGlobalTask: `import { taskMiddleware } from "@bluelibs/runner";

// Apply to every task (or filter with a predicate)
const auditAllTasks = taskMiddleware({
  id: "app.middleware.task.auditAll",
  everywhere: true, // or everywhere: (t) => t.id.startsWith("app.")
  run: async ({ task, next }) => {
    const started = Date.now();
    try {
      return await next(task.input);
    } finally {
      console.log('[task] ' + task.id + ' in ' + (Date.now() - started) + 'ms');
    }
  },
});`,

  middlewareResourceSoftDelete: `import { resourceMiddleware } from "@bluelibs/runner";

// Intercept a resource after it initializes
const softDelete = resourceMiddleware({
  id: "app.middleware.resource.softDelete",
  run: async ({ resource, next }) => {
    const instance = await next(resource.config);
    const originalDelete = instance.delete;
    instance.delete = async (id: string, ...args: any[]) => {
      return instance.update(id, { deletedAt: new Date() }, ...args);
    };
    return instance;
  },
});`,

  middlewareGlobalResource: `import { resourceMiddleware } from "@bluelibs/runner";

const tagAll = resourceMiddleware({
  id: "app.middleware.resource.tagAll",
  everywhere: (r) => r.id.startsWith("app."),
  run: async ({ resource, next }) => {
    const value = await next(resource.config);
    return { ...value, __tag: "app" };
  },
});`,
};
