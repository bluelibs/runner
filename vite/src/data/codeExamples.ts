export const codeExamples = {
  tasks: `const sendEmail = task({
  id: "app.tasks.sendEmail",
  dependencies: { emailService, logger },
  run: async ({ to, subject, body }, { emailService, logger }) => {
    await logger.info(\`Sending email to \${to}\`);
    return await emailService.send({ to, subject, body });
  },
});

// Test it like a normal function
const result = await sendEmail.run(
  { to: "user@example.com", subject: "Hi", body: "Hello!" },
  { emailService: mockEmailService, logger: mockLogger }
);`,

  resources: `const database = resource({
  id: "app.db",
  init: async () => {
    const client = new MongoClient(process.env.DATABASE_URL);
    await client.connect();
    return client;
  },
  dispose: async (client) => await client.close(),
});

const userService = resource({
  id: "app.services.user",
  dependencies: { database },
  init: async (_, { database }) => ({
    async createUser(userData) {
      return database.collection("users").insertOne(userData);
    },
    async getUser(id) {
      return database.collection("users").findOne({ _id: id });
    },
  }),
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
});

// Listen with hooks
const sendWelcomeEmail = hook({
  id: "app.hooks.sendWelcomeEmail",
  on: userRegistered,
  run: async (eventData) => {
    console.log(\`Welcome email sent to \${eventData.data.email}\`);
  },
});`,

  middleware: `const authMiddleware = taskMiddleware({
  id: "app.middleware.auth",
  run: async ({ task, next }, _deps, config) => {
    // Auth logic here
    if (!task.input.user.authenticated) {
      throw new Error("Unauthorized");
    }
    return await next(task.input);
  },
});

const adminTask = task({
  id: "app.tasks.adminOnly", 
  middleware: [authMiddleware],
  run: async (input) => "Secret admin data",
});`,

  context: `const requestContext = context<{ userId: string; traceId: string }>({
  id: "app.context.request"
});

const authMiddleware = taskMiddleware({
  id: "app.middleware.auth",
  run: async ({ task, next, context }) => {
    const token = task.input.headers.authorization;
    const user = await verifyToken(token);
    
    // Set context for downstream tasks
    context.set(requestContext, { 
      userId: user.id, 
      traceId: generateTraceId() 
    });
    
    return await next(task.input);
  },
});`,

  interceptors: `const metricsInterceptor = interceptor({
  id: "app.interceptors.metrics",
  run: async ({ task, next }) => {
    const startTime = Date.now();
    
    try {
      const result = await next();
      recordMetric(task.id, Date.now() - startTime, 'success');
      return result;
    } catch (error) {
      recordMetric(task.id, Date.now() - startTime, 'error');
      throw error;
    }
  },
});`,

  optionalDeps: `const analyticsService = resource({
  id: "app.services.analytics",
  optional: true,
  init: async () => new AnalyticsClient(),
});

const trackUser = task({
  id: "app.tasks.trackUser",
  dependencies: { analyticsService },
  run: async (userData, { analyticsService }) => {
    // Graceful degradation if analytics is unavailable
    if (analyticsService) {
      await analyticsService.track('user_action', userData);
    }
    
    // Continue with core logic regardless
    return processUser(userData);
  },
});`,

  taskHooks: `const beforeTask = hook({
  id: "app.hooks.beforeTask",
  on: "task:before",
  run: async ({ taskId, input }) => {
    console.log(\`Starting task: \${taskId}\`);
  },
});

const afterTask = hook({
  id: "app.hooks.afterTask", 
  on: "task:after",
  run: async ({ taskId, result, duration }) => {
    console.log(\`Task \${taskId} completed in \${duration}ms\`);
  },
});`,

  logging: `const logger = resource({
  id: "app.logger",
  init: () => createLogger({
    level: 'info',
    format: combine(
      timestamp(),
      errors({ stack: true }),
      json()
    )
  }),
});

const processOrder = task({
  id: "app.tasks.processOrder",
  dependencies: { logger },
  run: async (orderData, { logger }) => {
    logger.info('Processing order', { orderId: orderData.id });
    
    try {
      const result = await processPayment(orderData);
      logger.info('Order processed successfully', { 
        orderId: orderData.id,
        amount: result.amount
      });
      return result;
    } catch (error) {
      logger.error('Order processing failed', { 
        orderId: orderData.id,
        error: error.message
      });
      throw error;
    }
  },
});`,

  caching: `const userCache = resource({
  id: "app.cache.users",
  init: () => new LRUCache<string, User>({ max: 1000, ttl: 300000 }),
});

const getUser = task({
  id: "app.tasks.getUser",
  dependencies: { userService, userCache },
  cache: { ttl: 300, key: (id) => \`user:\${id}\` },
  run: async (userId, { userService, userCache }) => {
    // Check cache first
    const cached = userCache.get(userId);
    if (cached) return cached;
    
    // Fetch from database
    const user = await userService.getUser(userId);
    userCache.set(userId, user);
    
    return user;
  },
});`,

  retries: `const flakyCacheService = resource({
  id: "app.services.cache",
  init: () => new RedisClient(),
});

const getCachedData = task({
  id: "app.tasks.getCachedData",
  dependencies: { flakyCacheService },
  retry: {
    attempts: 3,
    backoff: 'exponential',
    baseDelay: 100,
    maxDelay: 5000,
  },
  run: async (key, { flakyCacheService }) => {
    return await flakyCacheService.get(key);
  },
});`,

  timeouts: `const longRunningTask = task({
  id: "app.tasks.longRunning",
  timeout: 30000, // 30 seconds
  run: async (input) => {
    // This will be cancelled if it takes longer than 30s
    return await processLargeDataset(input);
  },
});

const criticalTask = task({
  id: "app.tasks.critical",
  timeout: {
    duration: 5000,
    onTimeout: async () => {
      // Cleanup logic
      await cleanupResources();
      throw new Error('Task timed out - resources cleaned up');
    }
  },
  run: async (input) => {
    return await performCriticalOperation(input);
  },
});`,
};