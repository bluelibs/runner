# Runner Expert Examples

Runnable TypeScript examples demonstrating core Runner concepts and patterns.

## Running Examples

```bash
# Run any example directly with ts-node
npx ts-node examples/01-basic-task.ts

# Or compile and run
npx tsc examples/01-basic-task.ts
node examples/01-basic-task.js
```

## Available Examples

### 01-basic-task.ts
**Basic task creation and execution**
- Simple task with input/output typing
- Running tasks
- Proper cleanup

### 02-resource-with-dispose.ts
**Resource lifecycle management**
- Creating singletons (resources)
- Resource initialization
- Automatic disposal/cleanup
- Using resources in tasks

### 03-dependency-injection.ts
**Dependency injection patterns**
- Basic DI with dependencies()
- Optional dependencies
- Dynamic dependencies based on config
- Using global resources

### 04-events-and-hooks.ts
**Event-driven architecture**
- Creating and emitting typed events
- Hook listeners with execution order
- stopPropagation() usage
- Decoupled communication

### 05-middleware.ts
**Cross-cutting concerns with middleware**
- Creating task middleware
- Applying middleware to tasks
- Global middleware with .everywhere()
- Middleware execution order

### 06-async-context.ts
**Request-scoped data with async context**
- Creating async context
- Providing context in a scope
- Using context in tasks
- Context flowing through call stack

### 07-tags-discovery.ts
**Runtime discovery with tags**
- Creating typed tags
- Tagging tasks with metadata
- Runtime discovery of tagged items
- Auto-registration patterns (HTTP routes)

## Notes

- All examples are self-contained and runnable
- Examples use `console.log` for educational purposes
- Check inline comments for detailed explanations
- Each example exports components for reuse in tests
