# BlueLibs Runner: Functional Programming Without Classes

← [Back to main README](../README.md)

---

_Or: How I Learned to Stop Worrying and Love Closures_

This guide shows how to build applications using BlueLibs Runner's functional approach. Instead of thinking in classes, think in terms of functions that return capabilities. You get the power of OOP patterns with the simplicity and testability of functions. With 100% type-safety.

## Why Functions > Classes

The core idea is that **resources are factories** that return API objects.

```ts
// Bad: Instead of a class...
class UserService {
  constructor(private db: Database) {}
  async getUser(id: string) {
    /* ... */
  }
}

// Good: Use a resource that returns an API object.
import { r } from "@bluelibs/runner";

const userService = r
  .resource("app.services.user")
  .dependencies({ db: database })
  .init(async (_config, { db }) => {
    // Private state is managed by closures
    const cache = new Map<string, User>();

    // The returned object is your public interface
    return {
      async getUser(id: string) {
        if (cache.has(id)) return cache.get(id);
        const user = await db.findUser(id);
        cache.set(id, user);
        return user;
      },
    };
  })
  .build();
```

## Private State with Closures

Variables declared inside `init` but outside the returned object are completely private.

```ts
const secureWallet = r
  .resource("app.wallet")
  .init(async (config: { initialBalance: number }) => {
    // Good: Private state - invisible from the outside
    let balance = config.initialBalance;

    // Good: Private helper function
    const validate = (amount: number) => {
      if (balance < amount) throw new Error("Insufficient funds");
    };

    // Good: Public API - only these methods are accessible
    return {
      getBalance: () => balance,
      debit(amount: number) {
        validate(amount);
        balance -= amount;
      },
    };
  })
  .build();
```

### Cleanup with `dispose`

Resources can define a `dispose` function to clean up private state when the container shuts down. This is the functional equivalent of a destructor.

```ts
// Assume Connection and createConnection are defined elsewhere
const connectionPool = r
  .resource("app.db.pool")
  .init(async (config: { connectionString: string }) => {
    const connections: Connection[] = [];

    return {
      acquire() {
        const conn = createConnection(config.connectionString);
        connections.push(conn);
        return conn;
      },
    };
  })
  .dispose(async (api) => {
    // Cleanup: close all connections when the container shuts down
    // The api parameter is the object returned from init
  })
  .build();
```

### Isolation Guarantee

Each `run()` creates a completely isolated container. Closure state is **never shared** between containers, which makes Runner ideal for multi-tenant or test scenarios.

```ts
import { r, run } from "@bluelibs/runner";

// Each app is a root resource that registers secureWallet with its own config
const app1 = r
  .resource("app.1")
  .dependencies({ wallet: secureWallet })
  .register([secureWallet.with({ initialBalance: 100 })])
  .init(async (_, { wallet }) => ({ wallet }))
  .build();

const app2 = r
  .resource("app.2")
  .dependencies({ wallet: secureWallet })
  .register([secureWallet.with({ initialBalance: 200 })])
  .init(async (_, { wallet }) => ({ wallet }))
  .build();

// These two containers have completely separate wallet state
const result1 = await run(app1);
const result2 = await run(app2);

result1.value.wallet.debit(50); // result2's wallet is unaffected

await result1.dispose();
await result2.dispose();
```

## Extension and Composition

### Extension via `r.override()`

`r.override()` is ideal for replacing behavior while keeping the same id. For decorator-style extension, prefer a wrapper resource composed through DI so lifecycle and dependencies stay explicit and predictable.

```ts
// Assume loggerService is a resource defined elsewhere
const baseEmailer = r
  .resource("app.emailer")
  .init(async (config: { apiKey: string }) => ({
    async send(to: string, subject: string, body: string) {
      // Real email logic...
    },
  }))
  .build();

// Decorate via composition (recommended for extension)
const loggingEmailer = r
  .resource("app.emailer.logging")
  .dependencies({ emailer: baseEmailer, logger: loggerService })
  .init(async (_config, { emailer, logger }) => ({
    async send(to: string, subject: string, body: string) {
      logger.info(`Sending email to ${to}`);
      await emailer.send(to, subject, body);
      logger.info(`Email sent to ${to}`);
    },
  }))
  .build();

// For testing, you can completely replace the implementation:
const mockEmailer = r
  .override(baseEmailer)
  .init(async () => {
    const sentEmails: any[] = [];
    return {
      async send(to: string, subject: string, body: string) {
        sentEmails.push({ to, subject, body });
      },
      getSentEmails: () => sentEmails,
    };
  })
  .build();
```

### Composition via Dependency Injection

The best way to compose resources is through dependency injection. For conditional logic, `.optional()` is very useful.

```ts
const smartUserService = r
  .resource("app.services.user.smart")
  .dependencies({
    db: database,
    cache: cacheService.optional(), // Optional dependency
  })
  .init(async (_, { db, cache }) => {
    // Fallback to a simple cache if no cache resource is registered
    const effectiveCache = cache || new Map();

    return {
      async getUser(id: string) {
        const cached = effectiveCache.get(id);
        return cached || db.findUser(id);
      },
    };
  })
  .build();
```

_Note: While you can manually call another resource's `.init()` for composition, prefer DI to keep your code decoupled._

## Contract Tags as Interfaces

Contract tags enforce the return shape of a resource or task at compile time, acting as powerful, configurable interfaces.

```ts
import { r } from "@bluelibs/runner";

// Define contracts for expected data shapes
const userContract = r
  .tag<void, void, { name: string }>("contract.user")
  .build();
const ageContract = r.tag<void, void, { age: number }>("contract.age").build();

// A task must return the intersection of all its contract shapes
const getUserProfile = r
  .task("app.tasks.getUserProfile")
  .tags([userContract, ageContract])
  .run(async () => {
    // Good: TypeScript enforces this return shape: { name: string } & { age: number }
    return { name: "Ada", age: 37 };
  })
  .build();

// This works for resources too
const profileService = r
  .resource("app.resources.profile")
  .tags([userContract])
  .init(async () => {
    // Good: Must return { name: string }
    return { name: "Ada" };
  })
  .build();
```

This approach is more flexible than traditional interfaces because contracts can be composed and discovered at runtime.

## OOP vs. Runner Parallels

| OOP Concept         | Runner Pattern                | Example                                                                      |
| ------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| **Class**           | Resource returning API object | `r.resource("app.service").init(async () => ({ method: () => {} })).build()` |
| **Constructor**     | `init()` function             | `.init(async (config, deps) => { /* setup */ })`                             |
| **Destructor**      | `dispose()` function          | `.dispose(async (api) => { /* cleanup */ })`                                 |
| **Private members** | Closured `const`/`let`        | `const secret = ...; return { /* public */ }`                                |
| **Public methods**  | Returned object methods       | `return { publicMethod: () => {} }`                                          |
| **Inheritance**     | `r.override()` with decorator | `r.override(base).init(...).build()`                                         |
| **Composition**     | Resource dependencies         | `.dependencies({ db, logger })`                                              |
| **Interfaces**      | Contract tags                 | `.tag<..., { shape }>()`                                                     |
| **Encapsulation**   | Closure-based privacy         | Private state is inaccessible from outside `init`.                           |

## Advanced Patterns

The functional approach supports many classic design patterns.

### Strategy Pattern

Use contract tags to discover and select implementations at runtime.

```ts
import { r, globals } from "@bluelibs/runner";

// 1. Define the strategy contract
const paymentStrategyContract = r
  .tag<
    void,
    void,
    { process(amount: number): Promise<boolean> }
  >("contract.paymentStrategy")
  .build();

// 2. Implement concrete strategies
const creditCardStrategy = r
  .resource("payment.strategies.creditCard")
  .tags([paymentStrategyContract])
  .init(async () => ({
    async process(amount: number) {
      /* charge credit card... */ return true;
    },
  }))
  .build();

// 3. Use the strategies via the store
const paymentProcessor = r
  .resource("app.payment.processor")
  .dependencies({ store: globals.resources.store })
  .init(async (_config, { store }) => ({
    async process(amount: number, method: string) {
      const strategies = store.getResourcesWithTag(paymentStrategyContract);
      const strategy = strategies.find((s) => s.id.includes(method));
      if (!strategy) throw new Error("Strategy not found");
      return strategy.value.process(amount);
    },
  }))
  .build();
```

### Observer Pattern

Use events and hooks for decoupled communication.

```ts
// 1. The subject emits events
const userRegistered = r
  .event("app.events.userRegistered")
  .payloadSchema<{ userId: string }>({ parse: (v) => v })
  .build();

const userService = r
  .resource("app.user.service")
  .dependencies({ userRegistered })
  .init(async (_config, { userRegistered }) => ({
    async createUser() {
      const userId = "u1";
      await userRegistered({ userId });
    },
  }))
  .build();

// 2. Observers listen with hooks
const welcomeEmailer = r
  .hook("app.hooks.welcome")
  .on(userRegistered)
  .run(async (e) => console.log(`Sending welcome email to ${e.data.userId}`))
  .build();
```

## Key Takeaways

1.  **Resources are factories** that return API objects.
2.  **Closures create privacy** for state and helpers.
3.  **`dispose` handles cleanup** — the functional destructor.
4.  **`r.override()` enables extension** via the decorator pattern.
5.  **Prefer DI for composition** to keep components decoupled.
6.  **Contract tags are configurable interfaces** that provide compile-time safety.
7.  **Each `run()` call is fully isolated** — closure state is never shared between containers.

This functional approach gives you the power of OOP without the boilerplate, leading to simpler, more testable, and more composable code.
