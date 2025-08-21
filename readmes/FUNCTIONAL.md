# BlueLibs Runner: Functional Programming Without Classes

_Or: How I Learned to Stop Worrying and Love Closures_

This guide shows how to build applications using BlueLibs Runner's functional approach. Instead of thinking in classes, think in terms of functions that return capabilities. You get the power of OOP patterns with the simplicity and testability of functions. With 100% type-safety.

## Why Functions > Classes

The core idea is that **resources are factories** that return API objects.

```ts
// ❌ Instead of a class...
class UserService {
  constructor(private db: Database) {}
  async getUser(id: string) {
    /* ... */
  }
}

// ✅ ...use a resource that returns an API object.
const userService = resource({
  id: "app.services.user",
  dependencies: { db: database },
  init: async (_, { db }) => {
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
  },
});
```

## Private State with Closures

Variables declared inside `init` but outside the returned object are completely private.

```ts
const secureWallet = resource({
  id: "app.wallet",
  init: async (config: { initialBalance: number }) => {
    // ✅ Private state - invisible from the outside
    let balance = config.initialBalance;

    // ✅ Private helper function
    const validate = (amount: number) => {
      if (balance < amount) throw new Error("Insufficient funds");
    };

    // ✅ Public API - only these methods are accessible
    return {
      getBalance: () => balance,
      debit(amount: number) {
        validate(amount);
        balance -= amount;
      },
    };
  },
});
```

## Extension and Composition

### Extension via `override`

`override()` lets you replace or extend a resource. To extend, you can create the original resource inside your override's `init` and wrap it. This is the **Decorator Pattern**.

```ts
const baseEmailer = resource({
  id: "app.emailer",
  init: async (config: { apiKey: string }) => ({
    async send(to: string, subject: string, body: string) {
      // Real email logic...
    },
  }),
});

// Decorate the base emailer with logging
const loggingEmailer = override(baseEmailer, {
  dependencies: {
    ...baseEmailer.dependencies, // If you don't specify dependencies, the default will be inherited
    logger: loggerService, // Expand them
  },
  init: async (config, { logger }, ctx) => {
    // Manually init the original to decorate it
    const originalEmailer = await baseEmailer.init(config, {}, ctx);

    return {
      async send(to: string, subject: string, body: string) {
        logger.info(`Sending email to ${to}`);
        await originalEmailer.send(to, subject, body);
        logger.info(`Email sent to ${to}`);
      },
    };
  },
});

// For testing, you can completely replace the implementation:
const mockEmailer = override(baseEmailer, {
  init: async () => {
    const sentEmails: any[] = [];
    return {
      async send(to, subject, body) {
        sentEmails.push({ to, subject, body });
      },
      getSentEmails: () => sentEmails,
    };
  },
});
```

### Composition via Dependency Injection

The best way to compose resources is through dependency injection. For conditional logic, `.optional()` is very useful.

```ts
const smartUserService = resource({
  id: "app.services.user.smart",
  dependencies: {
    db: database,
    cache: cacheService.optional(), // Optional dependency
  },
  init: async (_, { db, cache }) => {
    // Fallback to a simple cache if no cache resource is registered
    const effectiveCache = cache || new Map();

    return {
      async getUser(id: string) {
        const cached = effectiveCache.get(id);
        return cached || db.findUser(id);
      },
    };
  },
});
```

_Note: While you can manually call another resource's `.init()` for composition, prefer DI to keep your code decoupled._

## Contract Tags as Interfaces

Contract tags enforce the return shape of a resource or task at compile time, acting as powerful, configurable interfaces.

```ts
import { tag, task, resource } from "@bluelibs/runner";

// Define contracts for expected data shapes
const userContract = tag<void, void, { name: string }>({ id: "contract.user" });
const ageContract = tag<void, void, { age: number }>({ id: "contract.age" });

// A task must return the intersection of all its contract shapes
const getUserProfile = task({
  id: "app.tasks.getUserProfile",
  tags: [userContract, ageContract],
  run: async () => {
    // ✅ TypeScript enforces this return shape: { name: string } & { age: number }
    return { name: "Ada", age: 37 };
  },
});

// This works for resources too
const profileService = resource({
  id: "app.resources.profile",
  tags: [userContract],
  init: async () => {
    // ✅ Must return { name: string }
    return { name: "Ada" };
  },
});
```

This approach is more flexible than traditional interfaces because contracts can be composed and discovered at runtime.

## OOP vs. Runner Parallels

| OOP Concept         | Runner Pattern                      | Example                                            |
| ------------------- | ----------------------------------- | -------------------------------------------------- |
| **Class**           | Resource returning API object       | `resource({ init: () => ({ method: ... }) })`      |
| **Constructor**     | `init()` function                   | `init: async (config, deps) => { /* setup */ }`    |
| **Private members** | Closured `const`/`let`              | `const secret = ...; return { /* public */ }`      |
| **Public methods**  | Returned object methods             | `return { publicMethod: () => {} }`                |
| **Inheritance**     | `override()` with decorator pattern | `override(base, { init: ... })`                    |
| **Composition**     | Resource dependencies               | `dependencies: { db, logger }`                     |
| **Interfaces**      | Contract tags                       | `tag<..., { shape }>()`                            |
| **Encapsulation**   | Closure-based privacy               | Private state is inaccessible from outside `init`. |

## Advanced Patterns

The functional approach supports many classic design patterns.

### Strategy Pattern

Use contract tags to discover and select implementations at runtime.

```ts
// 1. Define the strategy contract
const paymentStrategyContract = tag<
  void,
  void,
  { process(amount: number): Promise<boolean> }
>({
  id: "contract.paymentStrategy",
});

// 2. Implement concrete strategies
const creditCardStrategy = resource({
  id: "payment.strategies.creditCard",
  tags: [paymentStrategyContract],
  init: async () => ({
    async process(amount) {
      /* ... */ return true;
    },
  }),
});

// 3. Use the strategies
const paymentProcessor = resource({
  dependencies: { store: globals.resources.store },
  init: async (_, { store }) => ({
    async process(amount: number, method: string) {
      const strategies = store.getResourcesWithTag(paymentStrategyContract);
      const strategy = strategies.find((s) => s.id.includes(method));
      if (!strategy) throw new Error("Strategy not found");
      return strategy.value.process(amount);
    },
  }),
});
```

### Observer Pattern

Use events and hooks for decoupled communication.

```ts
// 1. The subject emits events
const userRegistered = event<{ userId: string }>({ id: "user.registered" });

const userService = resource({
  dependencies: { userRegistered },
  init: async (_, { userRegistered }) => ({
    async createUser() {
      const userId = "u1";
      await userRegistered(userRegistered, { userId });
    },
  }),
});

// 2. Observers listen with hooks
const welcomeEmailer = hook({
  on: userRegistered,
  run: async (e) => console.log(`Sending welcome email to ${e.data.userId}`),
});
```

## Key Takeaways

1.  **Resources are factories** that return API objects.
2.  **Closures create privacy** for state and helpers.
3.  **`override` enables extension** via the decorator pattern.
4.  **Prefer DI for composition** to keep components decoupled.
5.  **Contract tags are configurable interfaces** that provide compile-time safety.

This functional approach gives you the power of OOP without the boilerplate, leading to simpler, more testable, and more composable code.
