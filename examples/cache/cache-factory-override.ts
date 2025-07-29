import { task, resource, run, middleware, globals } from "@bluelibs/runner";

// Custom cache implementation (could be Redis, Memcached, etc.)
class CustomCache {
  private store = new Map<string, { value: any; expiry?: number }>();
  private name: string;

  constructor(options: { name?: string; ttl?: number } = {}) {
    this.name = options.name || "CustomCache";
    console.log(`🔧 Creating ${this.name} instance`);
  }

  set(key: string, value: any): void {
    console.log(`📝 ${this.name}: Setting key "${key}"`);
    this.store.set(key, { value, expiry: Date.now() + 5000 }); // 5 second TTL
  }

  get(key: string): any {
    const entry = this.store.get(key);
    if (!entry) {
      console.log(`❌ ${this.name}: Cache miss for key "${key}"`);
      return undefined;
    }

    if (entry.expiry && Date.now() > entry.expiry) {
      console.log(`⏰ ${this.name}: Cache expired for key "${key}"`);
      this.store.delete(key);
      return undefined;
    }

    console.log(`✅ ${this.name}: Cache hit for key "${key}"`);
    return entry.value;
  }

  clear(): void {
    console.log(`🧹 ${this.name}: Clearing cache`);
    this.store.clear();
  }
}

// Override the default cache factory task
const customCacheFactory = task({
  id: "global.tasks.cacheFactory", // Same ID as the default
  run: async (options: any) => {
    return new CustomCache({ name: "MyCustomCache", ...options });
  },
});

// Create some tasks that use caching
const expensiveCalculation = task({
  id: "app.tasks.expensiveCalculation",
  middleware: [globals.middlewares.cache.with({ ttl: 3000 })],
  run: async (input: { number: number }) => {
    console.log(`🔢 Performing expensive calculation for ${input.number}`);
    // Simulate expensive work
    await new Promise((resolve) => setTimeout(resolve, 100));
    return input.number * input.number;
  },
});

const fetchUserData = task({
  id: "app.tasks.fetchUserData",
  middleware: [globals.middlewares.cache.with({ ttl: 2000 })],
  run: async (input: { userId: string }) => {
    console.log(`👤 Fetching user data for ${input.userId}`);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      id: input.userId,
      name: `User ${input.userId}`,
      email: `user${input.userId}@example.com`,
    };
  },
});

// Main application
const app = resource({
  id: "app",
  register: [
    globals.resources.cache, // Register the cache resource
    expensiveCalculation,
    fetchUserData,
  ],
  overrides: [customCacheFactory], // Override the default cache factory
  dependencies: { expensiveCalculation, fetchUserData },
  async init(_, { expensiveCalculation, fetchUserData }) {
    console.log("🚀 Starting cache factory override example...\n");

    // Test expensive calculation with caching
    console.log("=== Testing Expensive Calculation ===");
    const result1 = await expensiveCalculation({ number: 5 });
    console.log(`Result 1: ${result1}`);

    const result2 = await expensiveCalculation({ number: 5 }); // Should be cached
    console.log(`Result 2: ${result2}`);

    const result3 = await expensiveCalculation({ number: 10 }); // Different input
    console.log(`Result 3: ${result3}\n`);

    // Test user data fetching with caching
    console.log("=== Testing User Data Fetching ===");
    const user1 = await fetchUserData({ userId: "123" });
    console.log(`User 1:`, user1);

    const user2 = await fetchUserData({ userId: "123" }); // Should be cached
    console.log(`User 2:`, user2);

    const user3 = await fetchUserData({ userId: "456" }); // Different user
    console.log(`User 3:`, user3);

    console.log("\n⏳ Waiting for cache to expire...");
    await new Promise((resolve) => setTimeout(resolve, 6000));

    console.log("\n=== Testing After Cache Expiry ===");
    const result4 = await expensiveCalculation({ number: 5 }); // Should recalculate
    console.log(`Result 4: ${result4}`);

    console.log("\n✨ Example completed!");
  },
});

// Run the example
run(app)
  .then(({ dispose }) => {
    console.log("\n🎯 Cache factory override example finished successfully!");

    // Clean up after a delay
    setTimeout(async () => {
      await dispose();
      console.log("👋 Resources disposed");
      process.exit(0);
    }, 1000);
  })
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
