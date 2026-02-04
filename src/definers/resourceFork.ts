import type { RegisterableItems, ResourceForkOptions } from "../types/resource";
import {
  symbolMiddlewareConfigured,
  symbolTagConfigured,
} from "../types/symbols";
import { defineError } from "./defineError";
import { defineEvent } from "./defineEvent";
import { defineHook } from "./defineHook";
import { defineResourceMiddleware } from "./defineResourceMiddleware";
import { defineTag } from "./defineTag";
import { defineTask } from "./defineTask";
import { defineTaskMiddleware } from "./defineTaskMiddleware";
import {
  isAsyncContext,
  isError,
  isEvent,
  isHook,
  isPhantomTask,
  isResource,
  isResourceMiddleware,
  isResourceWithConfig,
  isTag,
  isTask,
  isTaskMiddleware,
} from "./tools";

export type ResourceRegisterList =
  | Array<RegisterableItems>
  | ((config: any) => Array<RegisterableItems>)
  | undefined;

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function hasSymbol(value: unknown, sym: symbol): boolean {
  return isObject(value) && sym in value;
}

function cloneAsyncContextLazy(item: any, reId: (id: string) => string) {
  // Avoid module cycles:
  // defineAsyncContext imports a task middleware which imports define.ts,
  // and define.ts imports defineResource (which imports this module).
  const { defineAsyncContext: localDefineAsyncContext } =
    require("./defineAsyncContext") as {
      defineAsyncContext: (def: any) => any;
    };

  return localDefineAsyncContext({
    id: reId(item.id),
    serialize: item.serialize,
    parse: item.parse,
  });
}

function resolveReId(
  forkId: string,
  options: ResourceForkOptions | undefined,
): (id: string) => string {
  const fallback = (id: string) => `${forkId}.${id}`;
  const reId = options?.reId ?? fallback;
  return (id: string) => {
    const next = reId(id);
    if (typeof next !== "string" || next.length === 0) {
      throw new Error(`fork(reId) must return a non-empty string for "${id}"`);
    }
    return next;
  };
}

function cloneRegisterItems(
  items: Array<RegisterableItems>,
  reId: (id: string) => string,
): Array<RegisterableItems> {
  const cache = new Map<object, RegisterableItems>();

  function cloneHookOn(on: any) {
    if (on === "*") {
      return on;
    }
    if (Array.isArray(on)) {
      return on.map((eventDef) => cloneRegisterable(eventDef));
    }
    return cloneRegisterable(on);
  }

  function cloneRegisterable(item: RegisterableItems): RegisterableItems {
    if (typeof item === "object" && item !== null && cache.has(item)) {
      return cache.get(item)!;
    }

    let cloned: RegisterableItems;

    if (isResourceWithConfig(item)) {
      const forked = item.resource.fork(reId(item.resource.id), {
        register: "deep",
        reId,
      });
      cloned = forked.with(item.config as any);
    } else if (isResource(item)) {
      cloned = item.fork(reId(item.id), { register: "deep", reId });
    } else if (isPhantomTask(item)) {
      cloned = defineTask.phantom({
        id: reId(item.id),
        dependencies: item.dependencies,
        middleware: item.middleware,
        inputSchema: item.inputSchema,
        resultSchema: item.resultSchema,
        meta: item.meta,
        tags: item.tags,
        throws: item.throws,
      });
    } else if (isTask(item)) {
      cloned = defineTask({
        id: reId(item.id),
        dependencies: item.dependencies,
        middleware: item.middleware,
        run: item.run,
        inputSchema: item.inputSchema,
        resultSchema: item.resultSchema,
        meta: item.meta,
        tags: item.tags,
        throws: item.throws,
      });
    } else if (isEvent(item)) {
      cloned = defineEvent({
        id: reId(item.id),
        meta: item.meta,
        payloadSchema: item.payloadSchema,
        tags: item.tags,
        parallel: item.parallel,
      });
    } else if (isHook(item)) {
      cloned = defineHook({
        id: reId(item.id),
        dependencies: item.dependencies,
        on: cloneHookOn(item.on),
        order: item.order,
        run: item.run,
        meta: item.meta,
        tags: item.tags,
      });
    } else if (isTaskMiddleware(item)) {
      const base = defineTaskMiddleware({
        id: reId(item.id),
        dependencies: item.dependencies,
        configSchema: item.configSchema,
        run: item.run,
        meta: item.meta,
        tags: item.tags,
        everywhere: item.everywhere,
      });
      const configured = hasSymbol(item, symbolMiddlewareConfigured);
      cloned = configured ? base.with((item as { config: any }).config) : base;
    } else if (isResourceMiddleware(item)) {
      const base = defineResourceMiddleware({
        id: reId(item.id),
        dependencies: item.dependencies,
        configSchema: item.configSchema,
        run: item.run,
        meta: item.meta,
        tags: item.tags,
        everywhere: item.everywhere,
      });
      const configured = hasSymbol(item, symbolMiddlewareConfigured);
      cloned = configured ? base.with((item as { config: any }).config) : base;
    } else if (hasSymbol(item, symbolTagConfigured)) {
      const tagItem = item as {
        id: string;
        meta?: any;
        config: any;
        configSchema?: any;
      };
      const base = defineTag({
        id: reId(tagItem.id),
        meta: tagItem.meta,
        config: tagItem.config,
        configSchema: tagItem.configSchema,
      });
      cloned = base.with(tagItem.config);
    } else if (isTag(item)) {
      const tagItem = item as {
        id: string;
        meta?: any;
        config?: any;
        configSchema?: any;
      };
      cloned = defineTag({
        id: reId(tagItem.id),
        meta: tagItem.meta,
        config: tagItem.config,
        configSchema: tagItem.configSchema,
      });
    } else if (isError(item)) {
      const definition = (item as any).definition;
      cloned = defineError({ ...definition, id: reId(item.id) });
    } else if (isAsyncContext(item)) {
      cloned = cloneAsyncContextLazy(item, reId);
    } else {
      cloned = item;
    }

    if (typeof item === "object" && item !== null) {
      cache.set(item, cloned);
    }
    return cloned;
  }

  return items.map((item) => cloneRegisterable(item));
}

export function resolveRegisterForFork(
  register: ResourceRegisterList,
  forkId: string,
  options: ResourceForkOptions | undefined,
): ResourceRegisterList {
  const mode = options?.register ?? "keep";
  if (mode === "drop") {
    return [];
  }
  if (mode !== "deep") {
    return register;
  }
  if (!register) {
    return register;
  }

  const reId = resolveReId(forkId, options);
  if (typeof register === "function") {
    return (config: any) => cloneRegisterItems(register(config), reId);
  }
  return cloneRegisterItems(register, reId);
}
