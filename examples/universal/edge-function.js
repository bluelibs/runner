/**
 * Cloudflare Workers / Edge Runtime Example
 * Shows BlueLibs Runner working in edge environments
 */
import { run, resource, task } from "@bluelibs/runner";

// Cache resource using Web APIs
const cacheStore = resource({
  id: "edge-cache",
  init: async () => {
    // Use Map as a simple cache (could be Redis, KV store, etc.)
    const cache = new Map();

    return {
      get: async (key) => cache.get(key),
      set: async (key, value, ttl = 3600) => {
        cache.set(key, { value, expires: Date.now() + ttl * 1000 });
        return true;
      },
      clear: async () => cache.clear(),
    };
  },
});

// API handler task
const handleRequest = task({
  id: "handle-api-request",
  dependencies: { cache: cacheStore },
  run: async (request, { cache }) => {
    const url = new URL(request.url);
    const cacheKey = `api:${url.pathname}`;

    // Try cache first
    const cached = await cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return new Response(
        JSON.stringify({
          data: cached.value,
          cached: true,
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Generate new response
    const data = {
      path: url.pathname,
      method: request.method,
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get("user-agent") || "unknown",
    };

    // Cache the response
    await cache.set(cacheKey, data, 300); // 5 minutes

    return new Response(
      JSON.stringify({
        data,
        cached: false,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  },
});

// Edge app resource
const edgeApp = resource({
  id: "edge-app",
  register: [cacheStore, handleRequest],
  dependencies: { cache: cacheStore, handler: handleRequest },
  init: async (_, { cache, handler }) => {
    console.log("Edge app initialized");
    return { cache, handler };
  },
});

// Export the fetch handler for Cloudflare Workers
export default {
  async fetch(request, env, ctx) {
    try {
      // Run BlueLibs Runner in edge environment
      // - Uses Web APIs only
      // - No process management
      // - Lightweight AsyncLocalStorage polyfill
      const result = await run(edgeApp, {
        shutdownHooks: false, // No process in edge environment
        errorBoundary: true,
        logs: { printThreshold: "warn" }, // Less verbose in production
      });

      // Handle the request
      return await result.runTask(handleRequest, request);
    } catch (error) {
      console.error("Edge app error:", error);
      return new Response(
        JSON.stringify({
          error: "Internal Server Error",
          timestamp: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
};

// Alternative: Direct usage in other edge runtimes (Vercel Edge, Deno Deploy, etc.)
export async function handleEdgeRequest(request) {
  const result = await run(edgeApp);
  return await result.runTask(handleRequest, request);
}
