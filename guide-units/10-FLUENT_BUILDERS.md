## Fluent Builders (`r.*`)

For a more ergonomic and chainable way to define your components, Runner offers a fluent builder API under the `r` namespace. These builders are fully type-safe, improve readability for complex definitions, and compile to the standard Runner definitions with zero runtime overhead.

Here’s a quick taste of how it looks, with and without `zod` for validation:

```typescript
import { r, run } from "@bluelibs/runner";
import { z } from "zod";

// With Zod, the config type is inferred automatically
const emailerConfigSchema = z.object({
  smtpUrl: z.string().url(),
  from: z.string().email(),
});

const emailer = r
  .resource("app.emailer")
  .configSchema(emailerConfigSchema)
  .init(async ({ config }) => ({
    send: (to: string, body: string) => {
      console.log(
        `Sending from ${config.from} to ${to} via ${config.smtpUrl}: ${body}`,
      );
    },
  }))
  .build();

// Without a schema library, you can provide the type explicitly
const greeter = r
  .resource("app.greeter")
  .init(async (cfg: { name: string }) => ({
    greet: () => `Hello, ${cfg.name}!`,
  }))
  .build();

const app = r
  .resource("app")
  .register([
    emailer.with({
      smtpUrl: "smtp://example.com",
      from: "noreply@example.com",
    }),
    greeter.with({ name: "World" }),
  ])
  .dependencies({ emailer, greeter })
  .init(async (_, { emailer, greeter }) => {
    console.log(greeter.greet());
    emailer.send("test@example.com", "This is a test.");
  })
  .build();

await run(app);
```

The builder API provides a clean, step-by-step way to construct everything from simple tasks to complex resources with middleware, tags, and schemas.

For a complete guide and more examples, check out the [full Fluent Builders documentation](../readmes/FLUENT_BUILDERS.md).
