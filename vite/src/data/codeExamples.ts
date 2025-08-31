export const codeExamples = {
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
};
