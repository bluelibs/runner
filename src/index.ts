/**
 * @packageDocumentation
 *
 * # BlueLibs Runner
 *
 * A TypeScript-first dependency injection framework that combines functional programming
 * with enterprise features. No decorators, no magic - just explicit, testable code.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { r, run } from "@bluelibs/runner";
 *
 * // Define a task (a function with superpowers)
 * const greet = r.task("greet")
 *   .run(async (name: string) => `Hello, ${name}!`)
 *   .build();
 *
 * // Create and run your app
 * const app = r.resource("app").register([greet]).build();
 * const { runTask } = await run(app);
 *
 * console.log(await runTask(greet, "World")); // "Hello, World!"
 * ```
 *
 * ## Core Concepts
 *
 * - **Tasks**: Functions with dependency injection, middleware, and validation
 * - **Resources**: Singleton services with lifecycle management (init/dispose)
 * - **Events**: Type-safe messages for decoupled communication
 * - **Hooks**: Lightweight event handlers
 * - **Middleware**: Cross-cutting concerns (auth, logging, caching)
 *
 * ## Learn More
 *
 * - [Documentation](https://github.com/bluelibs/runner/blob/main/README.md)
 * - [Examples](https://github.com/bluelibs/runner/tree/main/examples)
 * - [API Reference](https://bluelibs.github.io/runner/)
 *
 * @module @bluelibs/runner
 */

export * from "./public";
export type * from "./defs";
export type * from "./public-types";
