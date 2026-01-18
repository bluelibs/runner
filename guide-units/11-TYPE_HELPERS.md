## Type Helpers

When you need to reference a task's input type in another function, or pass a resource's value type to a generic, these utility types save you from re-declaring the same shapes.

### Extracting types from components

```typescript
import { r } from "@bluelibs/runner";
import type {
  ExtractTaskInput,
  ExtractTaskOutput,
  ExtractResourceConfig,
  ExtractResourceValue,
  ExtractEventPayload,
} from "@bluelibs/runner";

// Define your components
const createUser = r
  .task("users.create")
  .run(async (input: { name: string; email: string }) => ({
    id: "user-123",
    ...input,
  }))
  .build();

const database = r
  .resource<{ connectionString: string }>("app.db")
  .init(async (cfg) => createConnection(cfg.connectionString))
  .build();

const userCreated = r
  .event<{ userId: string; email: string }>("users.created")
  .build();

// Extract types without re-declaring them
type CreateUserInput = ExtractTaskInput<typeof createUser>; // { name: string; email: string }
type CreateUserOutput = ExtractTaskOutput<typeof createUser>; // { id: string; name: string; email: string }
type DbConfig = ExtractResourceConfig<typeof database>; // { connectionString: string }
type DbValue = ExtractResourceValue<typeof database>; // Connection
type UserCreatedPayload = ExtractEventPayload<typeof userCreated>; // { userId: string; email: string }
```

### Practical use cases

**Building API handlers that match task signatures:**

```typescript
// Your task defines the contract
const processOrder = r
  .task("orders.process")
  .run(async (input: { orderId: string; priority: "low" | "high" }) => ({
    status: "processed" as const,
    orderId: input.orderId,
  }))
  .build();

// Your HTTP handler enforces the same types
type OrderInput = ExtractTaskInput<typeof processOrder>;
type OrderOutput = ExtractTaskOutput<typeof processOrder>;

app.post("/orders", async (req, res) => {
  const input: OrderInput = req.body; // Type-checked!
  const result: OrderOutput = await runTask(processOrder, input);
  res.json(result);
});
```

**Creating wrapper functions:**

```typescript
// A logging wrapper that preserves types
function withLogging<T extends ITask<any, any>>(task: T) {
  type Input = ExtractTaskInput<T>;
  type Output = ExtractTaskOutput<T>;

  return async (input: Input): Promise<Output> => {
    console.log(`Calling ${task.id}`, input);
    const result = await task.run(input, dependencies);
    console.log(`Result from ${task.id}`, result);
    return result;
  };
}
```

### Quick reference

| Helper                     | Extracts         | From     |
| -------------------------- | ---------------- | -------- |
| `ExtractTaskInput<T>`      | Input type       | Task     |
| `ExtractTaskOutput<T>`     | Return type      | Task     |
| `ExtractResourceConfig<T>` | Config parameter | Resource |
| `ExtractResourceValue<T>`  | Init return type | Resource |
| `ExtractEventPayload<T>`   | Payload type     | Event    |

> **runtime:** "Type helpers: TypeScript's 'I told you so' toolkit. You extract the input type from a task, slap it on an API handler, and suddenly your frontend and backend are sworn blood brothers. Until someone uses `as any`. Then I cry."
