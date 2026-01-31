# Object-Oriented Programming with BlueLibs Runner

← [Back to main README](../README.md)

---

_Or: How to Keep Your Classes and Have Runner Too_

Runner is excellent for wiring systems together (see `readmes/AI.md`), but that doesn't mean you shouldn't write classes. It means you don't need framework-specific classes. Keep your domain modeled with plain, testable classes, and let Runner handle lifecycle, wiring, configuration, and cross-cutting concerns.

## Table of Contents

- [Core Philosophy](#core-philosophy)
- [When to Use Classes](#when-to-use-classes)
- [Class Integration Patterns](#class-integration-patterns)
- [Advanced OOP Patterns](#advanced-oop-patterns)
- [Lifecycle Management](#lifecycle-management)
- [Dependency Injection for Classes](#dependency-injection-for-classes)
- [Testing Strategies](#testing-strategies)
- [Real-World Examples](#real-world-examples)
- [Best Practices](#best-practices)

## Core Philosophy

### Key Principles

- **No decorators or magic injection**: Your classes are plain TypeScript. Runner does not require decorators, parameter metadata, or runtime reflection tricks.
- **Container-first composition**: Resources, tasks, events, and middleware form a predictable, testable dependency graph. Your classes are created and used through resources (or factories) rather than implicit injection.
- **init() as an async constructor**: A `resource`'s `init()` is the place to construct, connect, authenticate, warm up, or hydrate your class—anything you'd do in an async constructor. Return the fully ready value. `dispose()` is the paired destructor.
- **Explicit contracts**: Validation and tag contracts make the edges between components clear. Keep business logic in classes; keep wiring and policies in Runner definitions.

### The Mental Model

Think of Runner as your **object lifecycle manager** and **dependency coordinator**, not your class framework. Your classes remain pure, portable, and testable. Runner just makes sure they get created with the right dependencies at the right time.

```ts
// ❌ Framework-heavy approach
@Injectable()
class UserService {
  constructor(
    @Inject("DATABASE") private db: Database,
    @Inject("LOGGER") private logger: Logger,
  ) {}
}

// ✅ Runner approach
class UserService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async createUser(userData: UserData): Promise<User> {
    this.logger.info("Creating user", { email: userData.email });
    return this.db.users.create(userData);
  }
}

// Wire it up in Runner
import { r } from "@bluelibs/runner";
const userService = r
  .resource("app.services.user")
  .dependencies({ db: database, logger: loggerService })
  .init(async (_config, { db, logger }) => new UserService(db, logger))
  .build();
```

## When to Use Classes

Use classes for cohesive, stateful domains:

### Domain Services

```ts
class PricingEngine {
  constructor(
    private readonly rules: PricingRule[],
    private readonly currency: CurrencyService,
  ) {}

  calculatePrice(product: Product, customer: Customer): Price {
    let basePrice = product.basePrice;

    for (const rule of this.rules) {
      basePrice = rule.apply(basePrice, product, customer);
    }

    return this.currency.convert(basePrice, customer.preferredCurrency);
  }
}
```

### Adapters

```ts
class DatabaseAdapter {
  constructor(private readonly client: MongoClient) {}

  async findUser(id: string): Promise<User | null> {
    const doc = await this.client.db().collection("users").findOne({ _id: id });
    return doc ? this.mapToUser(doc) : null;
  }

  private mapToUser(doc: any): User {
    return new User(doc._id, doc.name, doc.email);
  }
}
```

### Aggregates

```ts
class Order {
  private constructor(
    public readonly id: string,
    private items: OrderItem[],
    private status: OrderStatus,
  ) {}

  static create(customerId: string, items: OrderItem[]): Order {
    if (items.length === 0) throw new Error("Order must have items");
    return new Order(generateId(), items, "pending");
  }

  addItem(item: OrderItem): void {
    if (this.status !== "pending") {
      throw new Error("Cannot modify confirmed order");
    }
    this.items.push(item);
  }

  confirm(): void {
    if (this.items.length === 0) throw new Error("Cannot confirm empty order");
    this.status = "confirmed";
  }

  getTotal(): number {
    return this.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
  }
}
```

**Avoid** leaking framework concepts into your classes. They should be portable and testable in isolation.

## Class Integration Patterns

### Basic Resource Wrapping

The simplest pattern - wrap a class instance in a resource:

```ts
class EmailService {
  constructor(private readonly apiKey: string) {}

  async send(to: string, subject: string, body: string): Promise<void> {
    // Email sending logic
  }
}

const emailService = resource({
  id: "app.services.email",
  init: async (config: { apiKey: string }) => new EmailService(config.apiKey),
  dispose: async (service) => {
    // Cleanup if needed
  },
});
```

### Resource with Dependencies

Wire multiple classes together:

```ts
class UserRepository {
  constructor(private readonly db: Database) {}
  async create(user: UserData): Promise<User> { /* ... */ }
  async findById(id: string): Promise<User | null> { /* ... */ }
}

class UserService {
  constructor(
    private readonly repo: UserRepository,
    private readonly logger: Logger
  ) {}

  async registerUser(userData: UserData): Promise<User> {
    this.logger.info('Registering user', { email: userData.email });
    const user = await this.repo.create(userData);
    this.logger.info('User registered', { userId: user.id });
    return user;
  }
}

const userRepository = r
  .resource("app.repositories.user")
  id: "app.repositories.user",
  dependencies: { db: database },
  init: async (_, { db }) => new UserRepository(db)
  .build();

const userService2 = r
  .resource("app.services.user")
  .dependencies({ repo: userRepository, logger: loggerService })
  .init(async (_config, { repo, logger }) => new UserService(repo, logger))
  .build();
```

### Factory Pattern

For classes that need per-request or per-call instances:

```ts
class ReportBuilder {
  constructor(
    private readonly locale: string,
    private readonly currency: string,
    private readonly templates: TemplateEngine,
  ) {}

  build(data: ReportData): Report {
    const template = this.templates.get(data.type, this.locale);
    return new Report(template.render(data), this.currency);
  }
}

const reportFactory = r
  .resource("app.factories.report")
  .dependencies({ templates: templateEngine })
  .init(
    async (
      config: { defaultLocale: string; defaultCurrency: string },
      { templates },
    ) => {
      return (options?: { locale?: string; currency?: string }) => {
        return new ReportBuilder(
          options?.locale ?? config.defaultLocale,
          options?.currency ?? config.defaultCurrency,
          templates,
        );
      };
    },
  )
  .build();

// Usage in a task
const generateReport = r
  .task("app.tasks.generateReport")
  .dependencies({ reportFactory })
  .run(
    async (
      input: { type: string; data: any; locale?: string },
      { reportFactory },
    ) => {
      const builder = reportFactory({ locale: input.locale });
      return builder.build({ type: input.type, data: input.data });
    },
  )
  .build();
```

## Advanced OOP Patterns

### Inheritance with Runner

While composition is preferred, inheritance can work well with Runner:

```ts
abstract class BaseService {
  constructor(protected readonly logger: Logger) {}

  protected async withLogging<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    this.logger.info(`Starting ${operation}`);
    try {
      const result = await fn();
      this.logger.info(`Completed ${operation}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed ${operation}`, { error });
      throw error;
    }
  }
}

class UserService extends BaseService {
  constructor(
    logger: Logger,
    private readonly repo: UserRepository
  ) {
    super(logger);
  }

  async createUser(userData: UserData): Promise<User> {
    return this.withLogging('createUser', async () => {
      return this.repo.create(userData);
    });
  }
}

class ProductService extends BaseService {
  constructor(
    logger: Logger,
    private readonly repo: ProductRepository
  ) {
    super(logger);
  }

  async createProduct(productData: ProductData): Promise<Product> {
    return this.withLogging('createProduct', async () => {
      return this.repo.create(productData);
    });
  }
}

// Wire them up
const userService3 = r
  .resource("app.services.user")
  id: "app.services.user",
  dependencies: { logger: loggerService, repo: userRepository },
  init: async (_, { logger, repo }) => new UserService(logger, repo)
  .build();

const productService = r
  .resource("app.services.product")
  .dependencies({ logger: loggerService, repo: productRepository })
  .init(async (_config, { logger, repo }) => new ProductService(logger, repo))
  .build();
```

### Polymorphism via Contract Tags

Use contract tags to enforce interface compliance:

```ts
import { r } from "@bluelibs/runner";

// Define a contract for notification services
const notificationServiceContract = r.tag<void, void, {
  send(message: string, recipient: string): Promise<void>;
}>("contract.notificationService").build();

class EmailNotificationService {
  constructor(private readonly apiKey: string) {}

  async send(message: string, recipient: string): Promise<void> {
    // Email implementation
  }
}

class SmsNotificationService {
  constructor(private readonly apiKey: string) {}

  async send(message: string, recipient: string): Promise<void> {
    // SMS implementation
  }
}

// Resources implementing the contract
const emailNotificationService = r
  .resource("app.services.notifications.email")
  id: "app.services.notifications.email",
  tags: [notificationServiceContract],
  init: async (config: { apiKey: string }) => new EmailNotificationService(config.apiKey)
  .build();

const smsNotificationService = r
  .resource("app.services.notifications.sms")
  .tags([notificationServiceContract])
  .init(async (config: { apiKey: string }) => new SmsNotificationService(config.apiKey))
  .build()
});

// Use polymorphically
const notificationProcessor = resource({
  id: "app.services.notificationProcessor",
  dependencies: { store: globals.resources.store },
  init: async (_, { store }) => {
    return {
      async sendToAll(message: string, recipients: Array<{ type: string; address: string }>) {
        const services = store.getResourcesWithTag(notificationServiceContract);

        for (const recipient of recipients) {
          const service = services.find(s => s.id.includes(recipient.type));
          if (service) {
            await service.value.send(message, recipient.address);
          }
        }
      }
    };
  }
});
```

### Decorator Pattern with Middleware

Use middleware to add cross-cutting concerns to your classes:

```ts
class PaymentService {
  constructor(private readonly gateway: PaymentGateway) {}

  async processPayment(
    amount: number,
    cardToken: string,
  ): Promise<PaymentResult> {
    return this.gateway.charge(amount, cardToken);
  }
}

// Enhance the service with middleware-like behavior via resource middleware
const enhancedPaymentService = resource({
  id: "app.services.payment.enhanced",
  dependencies: { gateway: paymentGateway, logger: loggerService },
  middleware: [
    globals.middleware.resource.retry.with({ retries: 3 }),
    globals.middleware.resource.timeout.with({ ttl: 30000 }),
  ],
  init: async (_, { gateway, logger }) => {
    const service = new PaymentService(gateway);

    // Wrap methods to add logging
    const originalProcess = service.processPayment.bind(service);
    service.processPayment = async (amount: number, cardToken: string) => {
      logger.info("Processing payment", { amount });
      try {
        const result = await originalProcess(amount, cardToken);
        logger.info("Payment processed", {
          transactionId: result.transactionId,
        });
        return result;
      } catch (error) {
        logger.error("Payment failed", { error });
        throw error;
      }
    };

    return service;
  },
});
```

## Lifecycle Management

### init() Superpowers

Why `init()` is better than constructors:

```ts
class DatabaseService {
  private client?: MongoClient;
  private isHealthy = false;

  constructor(private readonly connectionString: string) {}

  // ❌ Constructor can't be async
  // constructor(connectionString: string) {
  //   await MongoClient.connect(connectionString); // Won't work!
  // }

  async connect(): Promise<void> {
    this.client = new MongoClient(this.connectionString);
    await this.client.connect();
    await this.runHealthCheck();
    this.isHealthy = true;
  }

  private async runHealthCheck(): Promise<void> {
    await this.client!.db().admin().ping();
  }

  async query(collection: string, filter: any): Promise<any[]> {
    if (!this.isHealthy) throw new Error('Database not connected');
    return this.client!.db().collection(collection).find(filter).toArray();
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.isHealthy = false;
    }
  }
}

const databaseService = r
  .resource("app.services.database")
  id: "app.services.database",
  // ✅ init() can be async - perfect for setup
  init: async (config: { connectionString: string }) => {
    const service = new DatabaseService(config.connectionString);
    await service.connect(); // Async initialization
    return service;
  }
  // ✅ dispose() ensures cleanup
  .dispose(async (service) => {
    await service.close();
  })
  .build();
```

### Validation and Contracts

Validate your class configurations and results:

```ts
import { z } from "zod";

const apiClientConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  timeout: z.number().positive().default(30000)
});

class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeout: number
  ) {}

  async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: controller.signal
      });
      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

const apiClient = r
  .resource("app.services.apiClient")
  id: "app.services.apiClient",
  configSchema: apiClientConfigSchema, // Validates config at registration
  init: async (config) => {
    return new ApiClient(config.baseUrl, config.apiKey, config.timeout);
  }
  .build();

// Usage with validation
const app = r
  .resource("app")
  .register([
    apiClient.with({
      baseUrl: "https://api.example.com",
      apiKey: process.env.API_KEY!,
      timeout: 60000
    })
  ]
});
```

### Complex Initialization

For classes that need complex async setup:

```ts
class AnalyticsService {
  private client?: AnalyticsClient;
  private eventQueue: AnalyticsEvent[] = [];
  private flushInterval?: NodeJS.Timeout;

  constructor(
    private readonly config: AnalyticsConfig,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    // Connect to analytics service
    this.client = new AnalyticsClient(this.config);
    await this.client.connect();

    // Load user segments from cache
    const segments = await this.loadUserSegments();
    await this.client.setSegments(segments);

    // Start background flush
    this.flushInterval = setInterval(() => this.flush(), 5000);

    this.logger.info("Analytics service initialized");
  }

  private async loadUserSegments(): Promise<UserSegment[]> {
    // Complex initialization logic
    return [];
  }

  async track(event: AnalyticsEvent): Promise<void> {
    this.eventQueue.push(event);
    if (this.eventQueue.length >= 100) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = this.eventQueue.splice(0);
    await this.client!.send(events);
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    // Flush remaining events
    await this.flush();

    if (this.client) {
      await this.client.disconnect();
    }
  }
}

const analyticsService = resource({
  id: "app.services.analytics",
  dependencies: { logger: loggerService },
  init: async (config: AnalyticsConfig, { logger }) => {
    const service = new AnalyticsService(config, logger);
    await service.initialize(); // Complex async setup
    return service;
  },
  dispose: async (service) => {
    await service.shutdown(); // Proper cleanup
  },
});
```

## Dependency Injection for Classes

### Constructor Injection

The standard pattern - inject dependencies through constructor:

```ts
class OrderService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly productRepo: ProductRepository,
    private readonly paymentService: PaymentService,
    private readonly logger: Logger,
  ) {}

  async createOrder(userId: string, items: OrderItem[]): Promise<Order> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new Error("User not found");

    // Validate products exist
    for (const item of items) {
      const product = await this.productRepo.findById(item.productId);
      if (!product) throw new Error(`Product ${item.productId} not found`);
    }

    const order = Order.create(userId, items);
    this.logger.info("Order created", { orderId: order.id, userId });

    return order;
  }
}

const orderService = resource({
  id: "app.services.order",
  dependencies: {
    userRepo: userRepository,
    productRepo: productRepository,
    paymentService: paymentService,
    logger: loggerService,
  },
  init: async (_, deps) =>
    new OrderService(
      deps.userRepo,
      deps.productRepo,
      deps.paymentService,
      deps.logger,
    ),
});
```

### Property Injection Alternative

Sometimes you need to inject after construction:

```ts
class CacheableService {
  private cache?: CacheService;

  constructor(private readonly dataSource: DataSource) {}

  setCache(cache: CacheService): void {
    this.cache = cache;
  }

  async getData(key: string): Promise<any> {
    if (this.cache) {
      const cached = await this.cache.get(key);
      if (cached) return cached;
    }

    const data = await this.dataSource.fetch(key);

    if (this.cache) {
      await this.cache.set(key, data, { ttl: 300000 });
    }

    return data;
  }
}

const cacheableService = resource({
  id: "app.services.cacheable",
  dependencies: {
    dataSource: dataSourceService,
    cache: cacheService.optional(), // Optional dependency
  },
  init: async (_, { dataSource, cache }) => {
    const service = new CacheableService(dataSource);
    if (cache) {
      service.setCache(cache);
    }
    return service;
  },
});
```

### Interface-Based Injection

Use TypeScript interfaces for loose coupling:

```ts
interface INotificationService {
  send(message: string, recipient: string): Promise<void>;
}

interface IUserRepository {
  findById(id: string): Promise<User | null>;
  create(userData: UserData): Promise<User>;
}

class UserService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly notificationService: INotificationService,
  ) {}

  async registerUser(userData: UserData): Promise<User> {
    const user = await this.userRepo.create(userData);
    await this.notificationService.send("Welcome to our platform!", user.email);
    return user;
  }
}

// Implementations can vary
class DatabaseUserRepository implements IUserRepository {
  async findById(id: string): Promise<User | null> {
    /* ... */
  }
  async create(userData: UserData): Promise<User> {
    /* ... */
  }
}

class EmailNotificationService implements INotificationService {
  async send(message: string, recipient: string): Promise<void> {
    /* ... */
  }
}

// Wire with interfaces
const userService = resource({
  id: "app.services.user",
  dependencies: {
    userRepo: userRepository, // implements IUserRepository
    notificationService: emailNotificationService, // implements INotificationService
  },
  init: async (_, { userRepo, notificationService }) =>
    new UserService(userRepo, notificationService),
});
```

## Testing Strategies

### Unit Testing Classes

Test classes directly without Runner:

```ts
describe("UserService", () => {
  let userService: UserService;
  let mockRepo: jest.Mocked<IUserRepository>;
  let mockNotificationService: jest.Mocked<INotificationService>;

  beforeEach(() => {
    mockRepo = {
      findById: jest.fn(),
      create: jest.fn(),
    };

    mockNotificationService = {
      send: jest.fn(),
    };

    userService = new UserService(mockRepo, mockNotificationService);
  });

  it("should create user and send notification", async () => {
    const userData = { name: "John", email: "john@example.com" };
    const createdUser = { id: "123", ...userData };

    mockRepo.create.mockResolvedValue(createdUser);
    mockNotificationService.send.mockResolvedValue();

    const result = await userService.registerUser(userData);

    expect(result).toEqual(createdUser);
    expect(mockRepo.create).toHaveBeenCalledWith(userData);
    expect(mockNotificationService.send).toHaveBeenCalledWith(
      "Welcome to our platform!",
      "john@example.com",
    );
  });
});
```

### Integration Testing with Runner

Test the full wiring:

```ts
describe("UserService Integration", () => {
  let testApp: any;
  let dispose: () => Promise<void>;

  beforeEach(async () => {
    // Create test doubles
    const mockUserRepo = {
      findById: jest.fn(),
      create: jest.fn(),
    };

    const mockNotificationService = {
      send: jest.fn(),
    };

    // Create test harness
    const testHarness = resource({
      id: "test.harness",
      register: [userService],
      overrides: [
        override(userRepository, {
          init: async () => mockUserRepo,
        }),
        override(emailNotificationService, {
          init: async () => mockNotificationService,
        }),
      ],
    });

    const result = await run(testHarness);
    testApp = result.value;
    dispose = result.dispose;
  });

  afterEach(async () => {
    await dispose();
  });

  it("should register user through full system", async () => {
    const userData = { name: "Jane", email: "jane@example.com" };

    const result = await testApp.runTask(registerUserTask, userData);

    expect(result.success).toBe(true);
    // Verify the full integration worked
  });
});
```

### Testing with Partial Mocks

Mix real and mock dependencies:

```ts
describe("OrderService with real validation", () => {
  let testApp: any;
  let dispose: () => Promise<void>;

  beforeEach(async () => {
    const mockPaymentService = {
      processPayment: jest.fn().mockResolvedValue({ success: true }),
    };

    const testHarness = resource({
      id: "test.harness",
      register: [
        orderService,
        userRepository, // Real user repository
        productRepository, // Real product repository
        logger, // Real logger
      ],
      overrides: [
        override(paymentService, {
          init: async () => mockPaymentService,
        }),
      ],
    });

    const result = await run(testHarness);
    testApp = result.value;
    dispose = result.dispose;
  });

  afterEach(async () => {
    await dispose();
  });

  it("should create order with real validation but mock payment", async () => {
    // Test uses real user/product validation but mocked payment
    const orderData = {
      userId: "user123",
      items: [{ productId: "prod456", quantity: 2 }],
    };

    const result = await testApp.runTask(createOrderTask, orderData);

    expect(result.orderId).toBeDefined();
  });
});
```

## Real-World Examples

### E-commerce Domain

```ts
// Domain entities
class Product {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly price: number,
    public readonly stock: number,
  ) {}

  isAvailable(quantity: number): boolean {
    return this.stock >= quantity;
  }
}

class Cart {
  private items: Map<string, { product: Product; quantity: number }> =
    new Map();

  addItem(product: Product, quantity: number): void {
    if (!product.isAvailable(quantity)) {
      throw new Error("Insufficient stock");
    }

    const existing = this.items.get(product.id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.items.set(product.id, { product, quantity });
    }
  }

  getTotal(): number {
    let total = 0;
    for (const { product, quantity } of this.items.values()) {
      total += product.price * quantity;
    }
    return total;
  }

  getItems(): Array<{ product: Product; quantity: number }> {
    return Array.from(this.items.values());
  }
}

// Services
class ProductService {
  constructor(private readonly repo: IProductRepository) {}

  async getProduct(id: string): Promise<Product | null> {
    return this.repo.findById(id);
  }

  async searchProducts(query: string): Promise<Product[]> {
    return this.repo.search(query);
  }
}

class CartService {
  constructor(
    private readonly productService: ProductService,
    private readonly logger: Logger,
  ) {}

  createCart(): Cart {
    return new Cart();
  }

  async addToCart(
    cart: Cart,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const product = await this.productService.getProduct(productId);
    if (!product) {
      throw new Error("Product not found");
    }

    cart.addItem(product, quantity);
    this.logger.info("Added to cart", { productId, quantity });
  }
}

class OrderService {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly inventoryService: InventoryService,
    private readonly logger: Logger,
  ) {}

  async checkout(cart: Cart, paymentInfo: PaymentInfo): Promise<Order> {
    const total = cart.getTotal();

    // Process payment
    const paymentResult = await this.paymentService.processPayment(
      total,
      paymentInfo,
    );

    // Reserve inventory
    for (const { product, quantity } of cart.getItems()) {
      await this.inventoryService.reserve(product.id, quantity);
    }

    const order = Order.create(cart.getItems(), paymentResult);
    this.logger.info("Order created", { orderId: order.id, total });

    return order;
  }
}

// Wire everything up
const productService = resource({
  id: "ecommerce.services.product",
  dependencies: { repo: productRepository },
  init: async (_, { repo }) => new ProductService(repo),
});

const cartService = resource({
  id: "ecommerce.services.cart",
  dependencies: { productService: productService, logger: loggerService },
  init: async (_, { productService, logger }) =>
    new CartService(productService, logger),
});

const orderService = resource({
  id: "ecommerce.services.order",
  dependencies: {
    paymentService: paymentService,
    inventoryService: inventoryService,
    logger: loggerService,
  },
  init: async (_, deps) =>
    new OrderService(deps.paymentService, deps.inventoryService, deps.logger),
});
```

### Event-Driven Architecture

```ts
interface DomainEvent {
  type: string;
  aggregateId: string;
  timestamp: Date;
  data: any;
}

class EventStore {
  private events: DomainEvent[] = [];

  append(event: DomainEvent): void {
    this.events.push(event);
  }

  getEvents(aggregateId: string): DomainEvent[] {
    return this.events.filter((e) => e.aggregateId === aggregateId);
  }
}

abstract class AggregateRoot {
  private uncommittedEvents: DomainEvent[] = [];

  protected addEvent(event: DomainEvent): void {
    this.uncommittedEvents.push(event);
  }

  getUncommittedEvents(): DomainEvent[] {
    return [...this.uncommittedEvents];
  }

  markEventsAsCommitted(): void {
    this.uncommittedEvents = [];
  }
}

class User extends AggregateRoot {
  constructor(
    public readonly id: string,
    public name: string,
    public email: string,
  ) {
    super();
  }

  updateEmail(newEmail: string): void {
    const oldEmail = this.email;
    this.email = newEmail;

    this.addEvent({
      type: "UserEmailUpdated",
      aggregateId: this.id,
      timestamp: new Date(),
      data: { oldEmail, newEmail },
    });
  }
}

class UserRepository {
  constructor(private readonly eventStore: EventStore) {}

  save(user: User): void {
    const events = user.getUncommittedEvents();
    for (const event of events) {
      this.eventStore.append(event);
    }
    user.markEventsAsCommitted();
  }

  load(id: string): User | null {
    const events = this.eventStore.getEvents(id);
    if (events.length === 0) return null;

    // Rebuild from events (simplified)
    const firstEvent = events[0];
    const user = new User(id, firstEvent.data.name, firstEvent.data.email);

    for (const event of events.slice(1)) {
      if (event.type === "UserEmailUpdated") {
        user.email = event.data.newEmail;
      }
    }

    return user;
  }
}

// Wire with Runner
const eventStore = resource({
  id: "app.eventStore",
  init: async () => new EventStore(),
});

const userRepository = resource({
  id: "app.repositories.user",
  dependencies: { eventStore },
  init: async (_, { eventStore }) => new UserRepository(eventStore),
});
```

## Best Practices

### Keep Classes Framework-Free

```ts
// ✅ Good - no framework dependencies
class PricingEngine {
  constructor(
    private readonly taxService: ITaxService,
    private readonly discountRules: DiscountRule[],
  ) {}

  calculatePrice(item: Item, customer: Customer): Price {
    let price = item.basePrice;

    // Apply discounts
    for (const rule of this.discountRules) {
      price = rule.apply(price, item, customer);
    }

    // Add tax
    const tax = this.taxService.calculateTax(price, customer.location);

    return new Price(price, tax);
  }
}

// ❌ Bad - tightly coupled to framework
@Component
class PricingEngine {
  @Inject("TAX_SERVICE") taxService: ITaxService;
  @Inject("DISCOUNT_RULES") discountRules: DiscountRule[];

  // Same logic but now untestable without framework
}
```

### Use Resources for Lifecycle

```ts
// ✅ Good - let Runner manage lifecycle
const cacheService = resource({
  id: "app.services.cache",
  init: async (config: CacheConfig) => {
    const service = new RedisCache(config);
    await service.connect();
    await service.ping(); // Health check
    return service;
  },
  dispose: async (service) => {
    await service.flush();
    await service.disconnect();
  },
});

// ❌ Bad - manual lifecycle management scattered throughout app
const cacheService = new RedisCache(config);
// Who calls connect()? When? Who handles errors?
// Who calls disconnect()? What if it's forgotten?
```

### Explicit Dependencies

```ts
// ✅ Good - explicit, testable dependencies
class OrderProcessor {
  constructor(
    private readonly paymentService: IPaymentService,
    private readonly inventoryService: IInventoryService,
    private readonly notificationService: INotificationService,
    private readonly logger: ILogger,
  ) {}
}

// ❌ Bad - hidden, hard-to-test dependencies
class OrderProcessor {
  async processOrder(order: Order) {
    // Hidden dependencies - where do these come from?
    await PaymentGateway.charge(order.total);
    await InventorySystem.reserve(order.items);
    await EmailService.send("Order confirmed", order.customerEmail);
    console.log("Order processed"); // No structured logging
  }
}
```

### Leverage Middleware for Policies

```ts
// ✅ Good - policies in middleware
const paymentService = resource({
  id: "app.services.payment",
  middleware: [
    globals.middleware.resource.retry.with({ retries: 3 }),
    globals.middleware.resource.timeout.with({ ttl: 30000 }),
    globals.middleware.resource.cache.with({ ttl: 60000 }),
  ],
  init: async (config) => new PaymentService(config),
});

// ❌ Bad - policies baked into class
class PaymentService {
  async processPayment(amount: number) {
    let attempt = 0;
    while (attempt < 3) {
      try {
        const timeout = setTimeout(() => {
          throw new Error("Timeout");
        }, 30000);
        const result = await this.gateway.charge(amount);
        clearTimeout(timeout);

        // Manual caching logic...
        this.cache.set(cacheKey, result);

        return result;
      } catch (error) {
        attempt++;
        if (attempt >= 3) throw error;
        await this.delay(1000 * attempt);
      }
    }
  }
}
```

### Use Tags for Discoverability

```ts
import { tag } from "@bluelibs/runner";

const healthCheckContract = tag<
  void,
  void,
  {
    health(): Promise<{ status: "healthy" | "unhealthy"; details?: any }>;
  }
>({ id: "contract.healthCheck" });

// Services implement health checks
const databaseService = resource({
  id: "app.services.database",
  tags: [healthCheckContract],
  init: async (config) => {
    const service = new DatabaseService(config);
    await service.connect();
    return service;
  },
});

// Automatic health check aggregation
const healthChecker = resource({
  id: "app.healthChecker",
  dependencies: { store: globals.resources.store },
  init: async (_, { store }) => {
    return {
      async checkAll() {
        const services = store.getResourcesWithTag(healthCheckContract);
        const results = await Promise.allSettled(
          services.map((s) => s.value.health()),
        );

        return {
          overall: results.every(
            (r) => r.status === "fulfilled" && r.value.status === "healthy",
          )
            ? "healthy"
            : "unhealthy",
          services: results.map((r, i) => ({
            service: services[i].id,
            result:
              r.status === "fulfilled"
                ? r.value
                : { status: "unhealthy", error: r.reason },
          })),
        };
      },
    };
  },
});
```

## Key Takeaways

1. **Keep classes pure** - No framework imports inside domain classes
2. **Use resources for lifecycle** - Async construction, validation, and cleanup
3. **Make dependencies explicit** - Wire through `dependencies` rather than hidden injection
4. **Leverage middleware for policies** - Don't bake cross-cutting concerns into classes
5. **Use contract tags** - Enable programmatic wiring and discoverability
6. **Test classes directly** - Unit test business logic without framework overhead
7. **Composition over inheritance** - Prefer wiring small, focused classes
8. **Factory pattern for instances** - When you need per-request or per-call objects

In short: **write great classes; let Runner do the wiring**. You gain strong lifecycle guarantees, composability, and zero-magic ergonomics without sacrificing OOP design principles.

_"The best frameworks get out of your way. The second best frameworks make the way obvious."_ 🚀
