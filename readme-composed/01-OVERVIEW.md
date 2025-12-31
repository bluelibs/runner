## What Is This Thing?

BlueLibs Runner is a TypeScript-first framework that embraces functional programming principles while keeping dependency injection simple enough that you won't need a flowchart to understand your own code. Think of it as the anti-framework framework – it gets out of your way and lets you build stuff that actually works.

### The Core

- **Tasks are functions** - Your business logic, nicely packaged with dependency injection
- **Resources are singletons** - Database connections, configs, services – things that live for your app's lifetime
- **Events are just events** - Decouple parts of your app so they can talk without tight coupling
- **Hooks are lightweight listeners** - React to events without the overhead of full tasks
- **Middleware** - Add cross-cutting concerns (logging, auth, caching) without cluttering your business logic
- **Everything is async** - Built for modern JavaScript/TypeScript
- **Explicit beats implicit** - You'll always know what's happening and why
- **Type-safe by default** - Catch mistakes at compile time, not at 3am in production

---

## 🔥 Show Me the Magic

**Here's what "zero magic" looks like in practice:**

```typescript
// 1️⃣ ONE LINE to add caching with TTL
const getUser = r
  .task("users.get")
  .middleware([cache.with({ ttl: 60000 })]) // ← That's it. 1 minute cache.
  .run(async (id) => db.query("SELECT * FROM users WHERE id = ?", id))
  .build();

// 2️⃣ ONE LINE to add retry with exponential backoff
const callAPI = r
  .task("api.call")
  .middleware([retry.with({ retries: 3, backoff: "exponential" })]) // ← Auto-retry failures
  .run(async (url) => fetch(url))
  .build();

// 3️⃣ ONE LINE to add authentication
const adminAction = r
  .task("admin.action")
  .middleware([auth.with({ role: "admin" })]) // ← Blocks non-admins
  .run(async () => "Secret admin stuff")
  .build();

// 4️⃣ Testing is actually pleasant
test("getUser works", async () => {
  const result = await getUser.run("user-123", { db: mockDb }); // ← Just call it
  expect(result.name).toBe("John");
});
```

**The magic? There isn't any.** It's just clean, composable functions.

---

## 📊 How Does It Compare?

| Feature               | Runner           | NestJS        | InversifyJS  | TypeDI        | tsyringe      |
| --------------------- | ---------------- | ------------- | ------------ | ------------- | ------------- |
| **Learning Curve**    | ⚡ Gentle        | 🏔️ Steep      | 🏔️ Steep     | 📚 Moderate   | 📚 Moderate   |
| **Magic/Decorators**  | ❌ None          | ✅ Heavy      | ✅ Heavy     | ✅ Heavy      | ✅ Heavy      |
| **Bundle Size**       | 🪶 Small         | 🦣 Large      | 🦣 Large     | 📦 Medium     | 📦 Medium     |
| **Type Safety**       | 💯 Perfect       | ⚠️ Runtime    | ⚠️ Runtime   | ⚠️ Runtime    | ⚠️ Runtime    |
| **Test Speed**        | ⚡ Instant       | 🐌 Slow       | 🐌 Slow      | 🚶 OK         | 🚶 OK         |
| **Built-in Features** | ✅ Everything    | ✅ Everything | ❌ Basic DI  | ❌ Basic DI   | ❌ Basic DI   |
| **Framework Lock-in** | ❌ None          | ✅ Heavy      | ❌ Light     | ❌ Light      | ❌ Light      |
| **Functional Style**  | ✅ Native        | ❌ Awkward    | ❌ Awkward   | ❌ Class-only | ❌ Class-only |
| **Middleware**        | ✅ Built-in      | ✅ Built-in   | ❌ Manual    | ❌ Manual     | ❌ Manual     |
| **Events**            | ✅ Built-in      | ✅ Built-in   | ❌ Manual    | ❌ Manual     | ❌ Manual     |
| **Async Context**     | ✅ Built-in      | ❌ Manual     | ❌ Manual    | ❌ Manual     | ❌ Manual     |
| **Debug Experience**  | 🎯 Crystal clear | 🤔 Confusing  | 🤔 Confusing | 🤔 Confusing  | 🤔 Confusing  |

**TL;DR:** Runner gives you the features of NestJS with the simplicity of plain functions.

---

## ⚡ Performance at a Glance

**Runner is FAST.** Here are real benchmarks from an M1 Max:

```
┌─────────────────────────────────────┬───────────────┬──────────────┐
│ Operation                           │ Ops/Second    │ Time/Op      │
├─────────────────────────────────────┼───────────────┼──────────────┤
│ Basic task execution                │ 2.2M          │ ~0.0005 ms   │
│ Task with 5 middlewares             │ 244K          │ ~0.004 ms    │
│ Resource initialization             │ 59.7K         │ ~0.017 ms    │
│ Event emission + handling           │ 245K          │ ~0.004 ms    │
│ 10-level dependency chain           │ 8.4K          │ ~0.12 ms     │
│ Cache middleware (hit)              │ 8M            │ ~0.000125 ms │
└─────────────────────────────────────┴───────────────┴──────────────┘

Overhead Analysis:
├─ Middleware overhead:  ~0.00026 ms per middleware (virtually zero)
├─ DI overhead:         ~0.001 ms (compile-time safety pays off)
├─ Memory footprint:    ~3.3 MB per 100 components
└─ Cache speedup:       3.65x faster (automatic optimization)
```

**What this means for you:**

- 🚀 **Instant feedback** - Tests run in milliseconds, not seconds
- 💰 **Lower cloud costs** - Handle more requests with fewer resources
- 🎯 **Production ready** - Battle-tested at scale (see [Performance](#performance) for details)

---

## 🎁 What's in the Box?

Runner comes with **everything you need** to build production apps:

<table>
<tr>
<td width="33%">

**🏗️ Core Architecture**

- ✅ Dependency Injection
- ✅ Lifecycle Management
- ✅ Type-safe Everything
- ✅ Zero Configuration
- ✅ Multi-platform (Node/Browser)

</td>
<td width="33%">

**🔥 Built-in Features**

- ✅ Caching (LRU + Custom)
- ✅ Retry with Backoff
- ✅ Timeouts
- ✅ Event System
- ✅ Middleware Pipeline
- ✅ Async Context
- ✅ Serialization

</td>
<td width="33%">

**🛠️ Developer Experience**

- ✅ Fluent API
- ✅ Debug Tools
- ✅ Error Boundaries
- ✅ Testing Utilities
- ✅ TypeDoc Integration
- ✅ Full TypeScript Support
- ✅ Tree-shakable

</td>
</tr>
<tr>
<td width="33%">

**📊 Observability**

- ✅ Structured Logging
- ✅ Task Interceptors
- ✅ Event Tracking
- ✅ Performance Metrics
- ✅ Debug Mode

</td>
<td width="33%">

**🔐 Production Ready**

- ✅ Graceful Shutdown
- ✅ Error Handling
- ✅ Typed Errors
- ✅ Optional Dependencies
- ✅ Semaphore/Queue
- ✅ Concurrency Control

</td>
<td width="33%">

**🌐 Advanced Patterns**

- ✅ Tunnels (Distributed)
- ✅ Tags System
- ✅ Factory Pattern
- ✅ Namespacing
- ✅ Overrides
- ✅ Meta/Documentation

</td>
</tr>
</table>

**No extra packages needed.** It's all included and works together seamlessly.

---
