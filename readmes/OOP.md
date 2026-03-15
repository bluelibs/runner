# Object-Oriented Programming with BlueLibs Runner

← [Back to main README](../README.md)

---

_Or: How to Keep Your Classes and Have Runner Too_

Runner doesn't tell you not to use classes. It tells your classes not to depend on a framework. Keep your domain modeled with plain, testable TypeScript classes that depend on **interfaces** — Runner acts as the IoC glue that wires implementations, manages lifecycle, and handles cross-cutting concerns.

## Table of Contents

- [Core Philosophy](#core-philosophy)
- [The Pattern](#the-pattern-interface--class--resource--task)
- [When Tasks Grow](#when-tasks-grow-from-inline-to-command)
- [Lifecycle Management](#lifecycle-management)
- [Cross-Cutting Concerns](#cross-cutting-concerns)
- [Polymorphism with Contract Tags](#polymorphism-with-contract-tags)
- [Factory Pattern](#factory-pattern)
- [Testing](#testing)
- [Key Takeaways](#key-takeaways)

## Core Philosophy

Think of Runner as your **object lifecycle manager** — not your class framework.

- **Classes own business logic** and depend on interfaces — no decorators, no reflection, no framework imports.
- **Resources own lifecycle**: `init()` constructs, `dispose()` destructs, `cooldown()` stops ingress.
- **Tasks are thin boundaries**: receive input → call class methods → return result.
- **Middleware handles policies** (retry, timeout, caching) — not your classes.

```ts
// Bad: framework-coupled class
@Injectable()
class UserService {
  constructor(
    @Inject("DATABASE") private db: Database,
    @Inject("LOGGER") private logger: Logger,
  ) {}
}

// Good: plain class, interface-driven
class UserService {
  constructor(
    private readonly repo: IUserRepository,
    private readonly logger: ILogger,
  ) {}

  async register(data: UserData): Promise<User> {
    this.logger.info("Registering user", { email: data.email });
    return this.repo.create(data);
  }
}
```

Runner wires this class exactly as written — no modifications needed:

```ts
import { Match, r } from "@bluelibs/runner";

const userServiceResource = r
  .resource("app.services.user")
  .dependencies({ repo: userRepository, logger: r.runner.logger })
  .init(async (_config, { repo, logger }) => new UserService(repo, logger))
  .build();
```

## The Pattern: Interface → Class → Resource → Task

A complete example showing how the four layers compose. The domain: a user registration system with email notifications.

### 1. Define the Interfaces

Your classes depend on these — not on Runner, not on concrete implementations.

```ts
// interfaces.ts — no Runner imports
interface IUserRepository {
  create(data: UserData): Promise<User>;
  findById(id: string): Promise<User | null>;
}

interface IMailer {
  send(to: string, subject: string, body: string): Promise<void>;
}
```

### 2. Implement the Classes

Plain TypeScript. Portable, testable, framework-free.

```ts
// user-repository.ts
class PostgresUserRepository implements IUserRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(data: UserData): Promise<User> {
    const row = await this.db.query("INSERT INTO users ...", data);
    return this.toUser(row);
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db.query("SELECT * FROM users WHERE id = $1", [id]);
    return row ? this.toUser(row) : null;
  }

  private toUser(row: DbRow): User {
    return { id: row.id, name: row.name, email: row.email };
  }
}

// mailer.ts
class SmtpMailer implements IMailer {
  private readonly transport: SmtpTransport;

  constructor(transport: SmtpTransport) {
    this.transport = transport;
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    await this.transport.sendMail({ to, subject, html: body });
  }
}
```

### 3. Wire with Resources

Resources are the IoC layer. `init()` is your async constructor — connect, authenticate, hydrate, then return the ready instance. `dispose()` is the paired destructor.

```ts
import { r } from "@bluelibs/runner";

// Infrastructure: database connection
const databaseResource = r
  .resource("app.resources.database")
  .schema({ connectionString: String })
  .init(async ({ connectionString }) => {
    const client = new DatabaseClient(connectionString);
    await client.connect();
    return client;
  })
  .dispose(async (client) => {
    await client.close();
  })
  .build();

// Repository: class instance wired with its dependency
const userRepository = r
  .resource("app.repositories.user")
  .dependencies({ db: databaseResource })
  .init(async (_config, { db }) => new PostgresUserRepository(db))
  .build();

// Mailer: class instance with lifecycle
const mailerResource = r
  .resource("app.resources.mailer")
  .schema({ host: String, port: Number })
  .dependencies({ logger: r.runner.logger })
  .init(async (config, { logger }) => {
    const transport = await SmtpTransport.create(config);
    logger.info("SMTP connected", { host: config.host });
    return new SmtpMailer(transport);
  })
  .dispose(async (mailer) => {
    await mailer.transport.close();
  })
  .build();

// Service: composed from other resources
const userServiceResource = r
  .resource("app.services.user")
  .dependencies({ repo: userRepository, logger: r.runner.logger })
  .init(async (_config, { repo, logger }) => new UserService(repo, logger))
  .build();
```

### 4. Expose via Tasks

Tasks are the boundary layer — thin async functions that receive input, delegate to class-backed resources, and return results. Business logic lives in the class; the task is just the entry point.

```ts
const registerUser = r
  .task("app.tasks.registerUser")
  .schema({ name: String, email: Match.Email })
  .dependencies({ userService: userServiceResource, mailer: mailerResource })
  .run(async (input, { userService, mailer }) => {
    const user = await userService.register(input);
    await mailer.send(user.email, "Welcome!", `Hello ${user.name}`);
    return user;
  })
  .build();
```

Notice: the task doesn't contain business logic. It orchestrates — call the service, send the email, return the result. The service owns the domain rules.

### 5. Compose the Application

```ts
import { run } from "@bluelibs/runner";

const app = r
  .resource("app")
  .register([
    databaseResource.with({ connectionString: process.env.DATABASE_URL! }),
    mailerResource.with({ host: "smtp.example.com", port: 587 }),
    userRepository,
    userServiceResource,
    registerUser,
  ])
  .build();

const runtime = await run(app);
await runtime.runTask(registerUser, { name: "Ada", email: "ada@example.com" });
await runtime.dispose();
```

## When Tasks Grow: From Inline to Command

Tasks start small — a few lines, a couple of dependencies, done. That's fine. You don't need a class for everything.

```ts
// Small task: inline is perfectly fine
const getUser = r
  .task("app.tasks.getUser")
  .schema({ id: String })
  .dependencies({ repo: userRepository })
  .run(async (input, { repo }) => {
    return repo.findById(input.id);
  })
  .build();
```

But tasks grow. What started as "create a user" becomes "create a user, validate uniqueness, hash the password, send a welcome email, emit an event, and log the audit trail." When a task accumulates business logic and multiple dependencies, extract it into a **command class**:

```ts
// register-user.command.ts — plain class, no Runner imports
class RegisterUserCommand {
  constructor(
    private readonly repo: IUserRepository,
    private readonly mailer: IMailer,
    private readonly hasher: IPasswordHasher,
    private readonly logger: ILogger,
  ) {}

  async execute(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<User> {
    const existing = await this.repo.findByEmail(input.email);
    if (existing) throw new Error("Email already registered");

    const hashed = await this.hasher.hash(input.password);
    const user = await this.repo.create({ ...input, password: hashed });

    this.logger.info("User registered", { userId: user.id });
    await this.mailer.send(user.email, "Welcome!", `Hello ${user.name}`);

    return user;
  }
}
```

Wire the command as a resource, expose it through a thin task:

```ts
const registerUserCommand = r
  .resource("app.commands.registerUser")
  .dependencies({
    repo: userRepository,
    mailer: mailerResource,
    hasher: passwordHasher,
    logger: r.runner.logger,
  })
  .init(
    async (_config, deps) =>
      new RegisterUserCommand(deps.repo, deps.mailer, deps.hasher, deps.logger),
  )
  .build();

const registerUser = r
  .task("app.tasks.registerUser")
  .schema({
    name: String,
    email: Match.Email,
    password: Match.NonEmptyString,
  })
  .dependencies({ command: registerUserCommand })
  .run(async (input, { command }) => command.execute(input))
  .build();
```

The task stays thin — one line of delegation. The command class owns the business logic, depends on interfaces, and is unit-testable without Runner.

**The rule of thumb:** any business-important operation (sending emails, charging payments, writing to a database) should be an injected dependency, not something the task reaches for directly. When the task body starts feeling heavy, that's your signal to extract a command class and let Runner wire its dependencies.

## Lifecycle Management

### init() as Async Constructor

Classes often need async setup that constructors can't provide. `init()` bridges this gap:

```ts
class RedisCache {
  constructor(private readonly client: RedisClient) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttl: number): Promise<void> {
    await this.client.set(key, value, { EX: ttl });
  }
}

const cacheResource = r
  .resource("app.resources.cache")
  .schema({ url: Match.URL })
  .init(async ({ url }) => {
    const client = createClient({ url });
    await client.connect(); // async — can't do this in a constructor
    await client.ping(); // health check before returning
    return new RedisCache(client);
  })
  .dispose(async (cache) => {
    await cache.client.disconnect();
  })
  .build();
```

### cooldown() for Ingress Services

For services that accept external traffic (HTTP servers, queue consumers), use `cooldown()` to stop intake before the drain wait. Treat it as an ingress switch — flip it, then let in-flight work finish naturally.

```ts
class HttpServer {
  constructor(
    readonly app: Express,
    private readonly listener: Server,
  ) {}

  close(): void {
    this.listener.close();
  }
}

const httpServer = r
  .resource("app.resources.httpServer")
  .schema({ port: Number })
  .init(async ({ port }) => {
    const app = express();
    const listener = app.listen(port);
    return new HttpServer(app, listener);
  })
  .cooldown(async (server) => {
    // Stop accepting new connections so in-flight requests can drain naturally
    server.close();
  })
  .build();
```

## Cross-Cutting Concerns

### Before: Policies Baked into Classes

This is what you want to avoid — retry, timeout, and logging tangled into business logic:

```ts
// Bad: the class owns policies it shouldn't care about
class PaymentGateway {
  async charge(amount: number): Promise<Receipt> {
    let attempt = 0;
    while (attempt < 3) {
      try {
        const timeout = setTimeout(() => {
          throw new Error("Timeout");
        }, 5000);
        const result = await this.client.charge(amount);
        clearTimeout(timeout);
        this.logger.info("Charged", { amount });
        return result;
      } catch (err) {
        attempt++;
        if (attempt >= 3) throw err;
        await delay(1000 * attempt);
      }
    }
    throw new Error("unreachable");
  }
}
```

### After: Policies in Middleware

Keep the class focused on its one job. Let Runner middleware handle the rest:

```ts
// Good: class does one thing
class PaymentGateway {
  constructor(private readonly client: PaymentClient) {}

  async charge(amount: number): Promise<Receipt> {
    return this.client.charge(amount);
  }
}

// Resource with middleware for cross-cutting concerns
const paymentGateway = r
  .resource("app.resources.payment")
  .dependencies({ client: paymentClient })
  .middleware([
    r.runner.middleware.resource.retry.with({ retries: 3, delay: 1000 }),
    r.runner.middleware.resource.timeout.with({ ttl: 5000 }),
  ])
  .init(async (_config, { client }) => new PaymentGateway(client))
  .build();

// Task with its own middleware
const chargeCustomer = r
  .task("app.tasks.chargeCustomer")
  .schema({ customerId: String, amount: Number })
  .dependencies({ gateway: paymentGateway })
  .middleware([
    r.runner.middleware.task.rateLimit.with({ max: 100, windowMs: 60_000 }),
  ])
  .run(async (input, { gateway }) => {
    return gateway.charge(input.amount);
  })
  .build();
```

Resource middleware protects resource initialization. Task middleware protects task execution. Your classes stay clean.

## Polymorphism with Contract Tags

Contract tags let multiple class implementations share an interface — Runner handles discovery via tag dependencies.

```ts
import { r } from "@bluelibs/runner";

// Contract: any resource tagged with this must expose a health() method
const healthCheckTag = r
  .tag<
    void,
    void,
    { health(): Promise<{ status: string }> }
  >("app.tags.healthCheck")
  .for(["resources"])
  .build();

// Two classes, same interface, both tagged
const databaseResource = r
  .resource("app.resources.database")
  .tags([healthCheckTag])
  .init(async () => new DatabaseService(/* ... */))
  .build();

const cacheResource = r
  .resource("app.resources.cache")
  .tags([healthCheckTag])
  .init(async () => new RedisCacheService(/* ... */))
  .build();

// Discover all tagged resources via tag dependency injection
const healthAggregator = r
  .task("app.tasks.healthCheck")
  .dependencies({ healthCheckTag })
  .run(async (_input, { healthCheckTag }) => {
    const results = await Promise.all(
      healthCheckTag.resources.map(async (entry) => ({
        id: entry.definition.id,
        ...(await entry.value.health()),
      })),
    );
    return {
      overall: results.every((r) => r.status === "healthy"),
      services: results,
    };
  })
  .build();
```

No runtime lookups, no string-based service locators — the tag dependency is fully typed and visibility-filtered.

## Factory Pattern

When you need per-call class instances instead of singletons, return a factory function from the resource:

```ts
class ReportBuilder {
  constructor(
    private readonly locale: string,
    private readonly templates: TemplateEngine,
  ) {}

  build(data: ReportData): Report {
    const template = this.templates.get(data.type, this.locale);
    return new Report(template.render(data));
  }
}

const reportFactory = r
  .resource("app.factories.report")
  .schema({ defaultLocale: String })
  .dependencies({ templates: templateEngine })
  .init(async (config, { templates }) => {
    // Resource value is a factory function, not a class instance
    return (locale?: string) =>
      new ReportBuilder(locale ?? config.defaultLocale, templates);
  })
  .build();

const generateReport = r
  .task("app.tasks.generateReport")
  .schema({
    type: String,
    data: Match.Any,
    locale: Match.Optional(String),
  })
  .dependencies({ createReport: reportFactory })
  .run(async (input, { createReport }) => {
    const builder = createReport(input.locale);
    return builder.build({ type: input.type, data: input.data });
  })
  .build();
```

## Testing

### Unit Testing Classes (No Runner)

Classes depending on interfaces are trivially testable without Runner:

```ts
describe("UserService", () => {
  it("should register a user", async () => {
    const mockRepo: IUserRepository = {
      create: jest
        .fn()
        .mockResolvedValue({ id: "1", name: "Ada", email: "ada@test.com" }),
      findById: jest.fn(),
    };
    const mockLogger: ILogger = { info: jest.fn(), error: jest.fn() };

    const service = new UserService(mockRepo, mockLogger);
    const user = await service.register({
      name: "Ada",
      email: "ada@test.com",
    });

    expect(user.id).toBe("1");
    expect(mockRepo.create).toHaveBeenCalledWith({
      name: "Ada",
      email: "ada@test.com",
    });
    expect(mockLogger.info).toHaveBeenCalled();
  });
});
```

No container, no bootstrap, no lifecycle — just plain construction and assertion.

### Integration Testing with Overrides

Test the full wiring by swapping implementations via `r.override(base, fn)`:

```ts
import { r, run } from "@bluelibs/runner";

describe("registerUser task", () => {
  it("should register and email user", async () => {
    const sent: string[] = [];

    const mockMailer = r.override(mailerResource, async () => ({
      send: async (to: string) => {
        sent.push(to);
      },
    }));

    const mockDb = r.override(databaseResource, async () => {
      const mockClient = {
        query: jest
          .fn()
          .mockResolvedValue({ id: "1", name: "Ada", email: "ada@test.com" }),
        connect: jest.fn(),
        close: jest.fn(),
      };
      return mockClient;
    });

    const testApp = r
      .resource("spec.app")
      .register([
        registerUser,
        userServiceResource,
        userRepository,
        mailerResource,
        databaseResource,
      ])
      .overrides([mockMailer, mockDb])
      .build();

    const runtime = await run(testApp);
    const user = await runtime.runTask(registerUser, {
      name: "Ada",
      email: "ada@test.com",
    });

    expect(user.name).toBe("Ada");
    expect(sent).toContain("ada@test.com");

    await runtime.dispose();
  });
});
```

## Key Takeaways

1. **Classes depend on interfaces** — Runner wires the implementations; your classes never know.
2. **Resources are the IoC layer** — `init()` constructs, `dispose()` destructs, `cooldown()` stops ingress.
3. **Tasks are thin boundaries** — receive input, delegate to class methods, return result. No business logic in tasks.
4. **Middleware owns policies** — retry, timeout, caching belong in middleware, not baked into your classes.
5. **Contract tags enable polymorphism** — discover tagged implementations without runtime lookups.
6. **Test classes directly** — interface-driven classes don't need Runner to be unit-tested.
7. **Test wiring with overrides** — `r.override(base, fn)` swaps implementations cleanly for integration tests.

In short: **write great classes; let Runner do the wiring.** Your domain stays portable, testable, and framework-free.
