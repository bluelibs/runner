/**
 * Core public TypeScript types for BlueLibs Runner.
 *
 * This file contains the strongly-typed contract for tasks, resources, events
 * and middleware. It mirrors the mental model described in the README:
 * - Tasks are functions
 * - Resources are singletons (with init/dispose hooks)
 * - Hooks are event listeners without middleware
 * - Events are simple, strongly-typed emissions
 * - Middleware can target both tasks and resources (taskMiddleware, resourceMiddleware)
 *
 * DX goals:
 * - Crystal‑clear generics and helper types that infer dependency shapes
 * - Friendly JSDoc you can hover in editors to understand usage instantly
 * - Safe overrides and strong typing around config and register mechanics
 */
export * from "./types/utilities";
export * from "./types/symbols";
export * from "./types/tag";
export * from "./types/hook";
export * from "./types/resource";
export * from "./types/event";
export * from "./types/task";
export * from "./types/taskMiddleware";
export * from "./types/resourceMiddleware";
export * from "./types/meta";
export * from "./types/runner";
export * from "./types/asyncContext";
export * from "./types/error";

// Useful other types that are kind-of spread out.
export { ICacheInstance } from "./globals/middleware/cache.middleware";
export * from "./types/storeTypes";
