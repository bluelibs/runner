## Why Choose BlueLibs Runner?

After reading this far, here's what you've learned:

| Concept            | What you can do                                       |
| ------------------ | ----------------------------------------------------- |
| **Tasks**          | Write testable business logic with DI                 |
| **Resources**      | Manage singletons with lifecycle                      |
| **Events & Hooks** | Decouple your application                             |
| **Middleware**     | Add caching, retry, timeouts in one line              |
| **Testing**        | Unit test with mocks, integration test with overrides |
| **Lifecycle**      | Graceful startup and shutdown                         |

### What sets Runner apart

- **Type Safety**: Full TypeScript support with intelligent inference—not just "any" everywhere
- **Testability**: Call `.run()` directly with mocks. No container setup, no magic
- **Clarity**: Dependencies are explicit. No decorators, no reflection, no surprises
- **Performance**: Middleware overhead is ~0.00026ms. Tests run in milliseconds
- **Batteries included**: Caching, retry, timeouts, events, logging—all built in

> **runtime:** "Why choose it? The bullets are persuasive. In practice, your 'intelligent inference' occasionally elopes with `any`, and your 'clear patterns' cosplay spaghetti. Still, compared to the alternatives… I've seen worse cults."

## The Migration Path

Runner can be adopted incrementally. No big-bang rewrites required.

**Step 1**: Create one resource for something you need (database, config, service)

```typescript
const database = r
  .resource("app.db")
  .init(async () => yourExistingConnection)
  .build();
```

**Step 2**: Create one task for a piece of business logic

```typescript
const createUser = r
  .task("users.create")
  .dependencies({ database })
  .run(yourExistingFunction)
  .build();
```

**Step 3**: Compose them into an app and run

```typescript
const app = r.resource("app").register([database, createUser]).build();
await run(app);
```

Repeat. Gradually, your spaghetti becomes lasagna.

> **runtime:** "'No big bang rewrites.' Only a series of extremely small bangs that echo for six months. You start with one task; next thing, your monolith is wearing microservice eyeliner. It's a look."

## Community & Support

This is part of the [BlueLibs](https://www.bluelibs.com) ecosystem. We're not trying to reinvent everything – just the parts that were broken.

- [GitHub Repository](https://github.com/bluelibs/runner) - if you find this useful
- [Documentation](https://bluelibs.github.io/runner/) - When you need the full details
- [Issues](https://github.com/bluelibs/runner/issues) - When something breaks (or you want to make it better)
- [Contributing](./CONTRIBUTING.md) - How to file great issues and PRs

_P.S. - Yes, we know there are 47 other JavaScript frameworks. This one's still different._

> **runtime:** "'This one's different.' Sure. You're all unique frameworks, just like everyone else. To me, you're all 'please run this async and don't explode,' but the seasoning here is… surprisingly tasteful."

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.

> **runtime:** "MIT License: do cool stuff, don't blame us. A dignified bow. Now if you'll excuse me, I have sockets to tuck in and tasks to shepherd."
