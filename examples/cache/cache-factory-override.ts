import { middleware, r, resources, run } from "@bluelibs/runner";

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

// Override the default cache provider so task cache middleware uses our custom implementation.
const customCacheProvider = r.override(resources.cacheProvider, async () => {
  return async (options = {}) =>
    new CustomCache({
      name: "MyCustomCache",
      ttl: typeof options.ttl === "number" ? options.ttl : undefined,
    });
});

// Create some tasks that use caching
const expensiveCalculation = r
  .task<{ number: number }>("expensiveCalculation")
  .middleware([middleware.task.cache.with({ ttl: 3000 })])
  .run(async (input) => {
    console.log(`🔢 Performing expensive calculation for ${input.number}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return input.number * input.number;
  })
  .build();

const fetchUserData = r
  .task<{ userId: string }>("fetchUserData")
  .middleware([middleware.task.cache.with({ ttl: 2000 })])
  .run(async (input) => {
    console.log(`👤 Fetching user data for ${input.userId}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      id: input.userId,
      name: `User ${input.userId}`,
      email: `user${input.userId}@example.com`,
    };
  })
  .build();

// Main application
const app = r
  .resource("app")
  .register([resources.cache, expensiveCalculation, fetchUserData])
  .overrides([customCacheProvider])
  .dependencies({ expensiveCalculation, fetchUserData })
  .init(async (_, { expensiveCalculation, fetchUserData }) => {
    console.log("🚀 Starting cache factory override example...\n");

    console.log("=== Testing Expensive Calculation ===");
    const result1 = await expensiveCalculation({ number: 5 });
    console.log(`Result 1: ${result1}`);

    const result2 = await expensiveCalculation({ number: 5 });
    console.log(`Result 2: ${result2}`);

    const result3 = await expensiveCalculation({ number: 10 });
    console.log(`Result 3: ${result3}\n`);

    console.log("=== Testing User Data Fetching ===");
    const user1 = await fetchUserData({ userId: "123" });
    console.log("User 1:", user1);

    const user2 = await fetchUserData({ userId: "123" });
    console.log("User 2:", user2);

    const user3 = await fetchUserData({ userId: "456" });
    console.log("User 3:", user3);

    console.log("\n⏳ Waiting for cache to expire...");
    await new Promise((resolve) => setTimeout(resolve, 6000));

    console.log("\n=== Testing After Cache Expiry ===");
    const result4 = await expensiveCalculation({ number: 5 });
    console.log(`Result 4: ${result4}`);

    console.log("\n✨ Example completed!");
  })
  .build();

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
