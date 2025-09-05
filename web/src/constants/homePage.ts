import {
  Coffee,
  Heart,
  Lightbulb,
  Smile,
  Star,
  Sparkles,
  Target,
  Trophy,
  Code,
  Zap,
  Check,
  Timer,
  Settings,
  Database,
  MessageSquare,
  GitBranch,
  Tag,
} from "lucide-react";

export const authorQuotes: string[] = [
  "I built Runner so future‑me stops arguing with past‑me at 3am.",
  "Dependency injection is just me handing myself fewer regrets.",
  "Middleware: onions for code, fewer tears.",
  "Resources are singletons because I enjoy one‑of‑a‑kind friendships.",
  "Tasks are functions because classes kept asking for lunch money.",
  "Events are just events; I refuse to add adjectives.",
  "If it feels like magic, I forgot to write the function.",
  "I like my types strict and my code relaxed.",
  "Benchmarks are my love letters to the CPU.",
  "Runner: because I needed fewer yak shaves per feature.",
  "I promise not to autowire your feelings.",
  "The only container I trust is a function scope.",
  "Refactoring is time travel without paradoxes.",
  "My favorite design pattern is 'delete 200 lines'.",
  "If the framework argues back, uninstall it.",
  "Config should be boring; drama belongs in movies.",
  "Edge cases are just introverts; invite them early.",
  "Graceful shutdown is how adults say goodbye.",
  "I use tags to remind code what it wants to be when it grows up.",
  "Queues are just lines where tasks learn patience.",
  "Semaphores: teaching code to take turns since forever.",
  "Validation is a hug with firm boundaries.",
  "The fastest feature is the one you didn't over‑engineer.",
  "I don't mock; I politely imitate.",
  "If tests feel brittle, they're telling you secrets.",
  "Abstractions should fit like T‑shirts, not tuxedos.",
  "Async is where bugs go camping; bring a flashlight.",
  "Shipping is a feature; everything else is scaffolding.",
  "Complexity tax is due every sprint; I avoid it with simplicity.",
  "The nicest thing you can do for prod is be predictable.",
  "Stop wiring Christmas trees; wire functions.",
  "Error messages should read like detective notes, not poetry.",
  "I optimize for 'future me says thanks'.",
  "The DI I want holds coffee, not mysteries.",
  "Hot take: comments should explain why, not narrate what.",
  "APIs should be obvious 10 minutes after a nap.",
  "Middleware is hospitality for cross‑cutting concerns.",
  "Events let me gossip between components safely.",
  "Dispose is the adult version of cleaning your room.",
  "I like my logs structured and my jokes unstructured.",
  "Time spent deleting code is never wasted.",
  "Performance is a feature when nobody notices.",
  "A good abstraction is one you forget exists.",
  "Type errors are love letters from the compiler.",
  "I prefer code that whispers 'trust me' and actually means it.",
  "If it's clever, it's probably future pain.",
  "Interfaces shouldn't need a tour guide.",
  "The best cache is not doing the work twice.",
  "Retry means 'I forgive you' but with a counter.",
  "Runner is my peace treaty with complexity.",
];

export const quoteIcons = [
  Coffee,
  Heart,
  Lightbulb,
  Smile,
  Star,
  Sparkles,
  Target,
  Trophy,
  Code,
  Zap,
  Check,
  Timer,
  Settings,
  Database,
  MessageSquare,
  GitBranch,
];

export const features = [
  {
    icon: Code,
    title: "Tasks are Functions",
    description:
      "Not classes with 47 methods you swear you'll refactor. Testable and composable functions with superpowers.",
    docAnchor: "tasks",
    example: `const sendEmailToUserTask = task({
  id: "app.tasks.sendEmailToUser",
  // Dependencies can be tasks, events and resources
  // tasks, events -> functions, resources -> init value
  dependencies: {
    emailService,
    emailSentEvent,
    increaseEmailCounterTask,
  },
  run: async ({ user, message }, {
    // This is where dependencies get injected
    emailService,
    emailSentEvent, // now function()
    increaseEmailCounterTask // now function()
  }) => {
    await emailService.send(user.email, message);
    await emailSentEvent({ to: user.email, message });

    // You can do this one asynchronously
    increaseEmailCounterTask();
  }
});`,
  },
  {
    icon: Database,
    title: "Resources are Singletons",
    description:
      "Database connections, configs, services - the usual suspects. Initialize once, use everywhere. They also register all type of elements.",
    docAnchor: "resources",
    example: `const database = resource({
  id: "app.db",
  register: [
    someTask,
    someEvent,
    someTaskMiddleware,
    someResourceMiddleware,
    someHook,
    someResource,
    someTag,
  ],
  init: async ({ dbUrl }) => {
    const client = new Database(dbUrl);
    // You could await connection, or you
    // could do it async if you want non-blocking startup.
    await client.connect();

    return client;
  },
  dispose: async (client) => await client.close()
});`,
  },
  {
    icon: MessageSquare,
    title: "Events are Just Events",
    description:
      "Decoupled communication via events and hooks. Emit events; ordered hooks run (you can stop propagation).",
    docAnchor: "events",
    example: `
const userRegisteredEvent = event<{ userId: string }>({
  id: "app.events.userRegistered"
});

// Listen with hooks
const sendWelcomeEmail = hook({
  id: "app.hooks.sendWelcomeEmail",
  on: userRegisteredEvent,
  run: async (event) => {
    console.log("Welcome new user:", event.data.userId);
  },
});
    
// Ensure the event and the hooks are registered

const myTask = task({
  id: "app.tasks.myTask",
  dependencies: { userRegisteredEvent },
  run: async (_, { userRegisteredEvent }) => {
    await userRegisteredEvent({ userId: '...' });
  },
});`,
  },
  {
    icon: Settings,
    title: "Middleware with Power",
    description:
      "Cross-cutting concerns with full lifecycle interception. Like onions, but with less tears.",
    docAnchor: "middleware",
    example: `type AuthType = { role: string };

const auth = taskMiddleware({
  id: "app.middleware.auth",
  run: async ({ task, next }, config: AuthType) =>
    next(task.input),
  // Make them run everywhere, default is false.
  everywhere: true,
});

const softDelete = resourceMiddleware({
  id: "app.middleware.softDelete",
  run: async ({ resource, next }) => next(resource.config),
  // everywhere can be very smart and efficient
  everywhere: (resource) => customTag.exists(resource)
});

// They work similar for tasks (on each run)
// and for resources (on init)
const usersList = task({
  id: "app.tasks.userList",
  middleware: [
    auth.with({ roles: "USER" }),
  ],
  // ... run function and rest
})
`,
  },
  {
    icon: Tag,
    title: "Tags for Contracts",
    description:
      "Attach metadata to tasks and resources. Use tags to enforce type contracts or to flag functionalities for programmatic access.",
    docAnchor: "tags",
    example: `const httpResponseTag = tag<Config, Input, Output>({ 
  // omit or use void if you want non-enforcing shapes
  // optional shapes and configs
  id: "app.tags.contract"
});

const createUser = task({
  id: "users.create",
  tags: [httpResponseTag],
  // The runner will enforce that the
  // output matches Output type from tag
  run: async (data) => {
    return { status: "ok" };
  }
});`,
  },
];

export const benchmarks = [
  {
    label: "Basic Task Execution",
    value: "2.51M tasks/sec",
    color: "from-green-400 to-blue-500",
  },
  {
    label: "With 5 Middlewares",
    value: "109K tasks/sec",
    color: "from-blue-400 to-purple-500",
  },
  {
    label: "Event Handling",
    value: "131K events/sec",
    color: "from-purple-400 to-pink-500",
  },
  {
    label: "Resource Inits",
    value: "20K inits/sec",
    color: "from-pink-400 to-red-500",
  },
];

export const whyChooseFeatures = [
  "No magic, no surprises — explicit beats implicit",
  "TypeScript-first with zero compromise on type safety",
  "High performance — 2.51M+ tasks per second",
  "Enterprise ready with graceful shutdown & error boundaries",
  "Structured logging, caching, retry, and timeouts built-in",
  "Functional style with simple dependency injection",
  "Optional validation for inputs, results, configs, payloads",
  "Concurrency primitives: Semaphore & Queue",
];

export const devToolsFeatures = [
  "GraphQL API for deep introspection",
  "GraphQL + Voyager Playground",
  "MCP server for AI assistant integration",
  "Real-time performance monitoring",
  "Hot-swapping function replacement",
  "Live logging and event tracking",
  "CLI tools with scaffolding support",
  "Custom diagnostics and health checks",
  "In-browser file preview and editing",
  "Correlation ID tracking for debugging",
];
