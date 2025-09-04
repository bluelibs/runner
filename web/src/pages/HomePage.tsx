import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeft,
  Zap,
  Code,
  Gauge,
  Check,
  Play,
  GitBranch,
  Database,
  MessageSquare,
  Settings,
  TrendingUp,
  Timer,
  Tag,
  Coffee,
  Heart,
  Lightbulb,
  Smile,
  Star,
  Sparkles,
  Target,
  Trophy,
  Brain,
  Zap as Lightning,
  Shuffle,
} from "lucide-react";
import CodeBlock from "../components/CodeBlock";
import Meta from "../components/Meta";

const HomePage: React.FC = () => {
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null);

  // Author quotes: funny and slightly absurd, shown one at a time in the testimonial card
  const authorQuotes: string[] = [
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
    "If it's clever, it’s probably future pain.",
    "Interfaces shouldn't need a tour guide.",
    "The best cache is not doing the work twice.",
    "Retry means 'I forgive you' but with a counter.",
    "Runner is my peace treaty with complexity.",
  ];

  const [quoteIndex, setQuoteIndex] = useState(0);

  // Fun icons to pair with quotes
  const quoteIcons = [
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

  const getRandomIcon = (index: number) => {
    return quoteIcons[index % quoteIcons.length];
  };

  const features = [
    {
      icon: Code,
      title: "Tasks are Functions",
      description:
        "Not classes with 47 methods you swear you'll refactor. Testable and composable functions with superpowers.",
      docAnchor: "tasks",
      example: `const sendEmail = task({
  id: "app.tasks.sendEmail",
  dependencies: { emailService },
  run: async ({ to, subject, body }) => {
    return await emailService.send({ to, subject, body });
  }
});`,
    },
    {
      icon: Database,
      title: "Resources are Singletons",
      description:
        "Database connections, configs, services - the usual suspects. Initialize once, use everywhere.",
      docAnchor: "resources",
      example: `const database = resource({
  id: "app.db",
  init: async () => {
    const client = new MongoClient(process.env.DATABASE_URL);
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
      example: `const userRegistered = event<{ userId: string }>({
  id: "app.events.userRegistered",
});

// Listen with hooks
const sendWelcomeEmail = hook({
  id: "app.hooks.sendWelcomeEmail",
  on: userRegistered,
  run: async (e) => {
    console.log("Welcome new user:", e.data.userId);
  },
});

// Emit event → triggers hooks
await userRegistered({ userId: "123" });`,
    },
    {
      icon: Settings,
      title: "Middleware with Power",
      description:
        "Cross-cutting concerns with full lifecycle interception. Like onions, but useful.",
      docAnchor: "middleware",
      example: `const auth = taskMiddleware({
  id: "app.middleware.auth",
  run: async ({ task, next }) => next(task.input),
});

const softDelete = resourceMiddleware({
  id: "app.middleware.softDelete",
  run: async ({ resource, next }) => next(resource.config),
});

// Global resource middleware (apply to all or by predicate)
const allResources = resourceMiddleware({
  id: "app.middleware.allResources",
  everywhere: true, // or: (resource) => boolean
  run: async ({ next }) => next(),
});`,
    },
    {
      icon: Tag,
      title: "Tags for Contracts",
      description:
        "Attach metadata to tasks and resources. Use tags to enforce type contracts or to flag functionalities for programmatic access.",
      docAnchor: "tags",
      example: `const contractTag = tag<Config, Input, Output>({ 
  // optional shapes and configs
  id: "app.tags.contract"
});\n\nconst createUser = task({
  id: "users.create",
  tags: [contractTag],
  // The runner will enforce that the
  // output matches Output type from tag
  run: async (data) => {
    return { id: "123", ...data };
  }
});\n\nconst sendEmail = task({
  id: "emails.send",
  // This task doesn't have the tag,
  // so no contract is enforced
  run: async () => { /* ... */ }
});`,
    },
  ];

  const benchmarks = [
    {
      label: "Basic Task Execution",
      value: "2.49M tasks/sec",
      color: "from-green-400 to-blue-500",
    },
    {
      label: "With 5 Middlewares",
      value: "244K tasks/sec",
      color: "from-blue-400 to-purple-500",
    },
    {
      label: "Event Handling",
      value: "246K events/sec",
      color: "from-purple-400 to-pink-500",
    },
    {
      label: "Resource Init",
      value: "59.7K resources/sec",
      color: "from-pink-400 to-red-500",
    },
  ];

  return (
    <div className="pt-16">
      <Meta
        title="Runner — TypeScript-first DI framework: fast, explicit, testable"
        description="Build production-ready TypeScript apps with tasks, resources, events, and middleware. No magic, full type-safety, 2.49M+ tasks/sec."
        image="/og/runner-og.svg"
      />
      {/* Hero Section */}
      <section className="min-h-[90vh] sm:min-h-screen flex items-center justify-center relative">
        {/* Background Effects */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-purple-50/30 to-pink-50/50 dark:from-blue-950/50 dark:via-purple-950/30 dark:to-pink-950/50"></div>

        {/* Full screen gradient swipe animation */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-400/30 via-purple-400/20 to-pink-400/30 animate-gradient-swipe"></div>
        </div>

        {/* Animated Background Elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-r from-blue-400/20 to-purple-400/20 rounded-full blur-3xl animate-pulse-slow animate-fade-in-right"></div>
          <div
            className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-r from-purple-400/20 to-pink-400/20 rounded-full blur-3xl animate-pulse-slow animate-fade-in-left"
            style={{ animationDelay: "0.5s" }}
          ></div>
        </div>

        <div className="max-w-7xl mx-auto px-12 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center py-20 sm:py-28">
            <div className="mb-12 sm:mb-16">
              {/* <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-100/50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-sm font-medium mb-4">
                <Star className="w-4 h-4 mr-2" />
                TypeScript-First Framework
              </div> */}
              <h1 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold text-gray-900 dark:text-white mb-10 sm:mb-12 px-4 sm:px-0">
                <span className="block">Stop Worrying and</span>
                <span className="">Love Dependency Injection</span>
              </h1>
              <p className="text-lg sm:text-xl md:text-2xl text-gray-600 dark:text-gray-300 max-w-4xl mx-auto mb-12 sm:mb-16 leading-relaxed px-4 sm:px-0">
                Runner is the anti-framework framework. It gets out of your way
                and lets you build stuff that actually works.
                <strong className="text-gray-900 dark:text-white">
                  {" "}
                  No magic, no surprises
                </strong>
                , just elegant code.
              </p>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-6 justify-center mb-16 sm:mb-24">
              <Link to="/quick-start" className="btn-primary group">
                Get Started
                <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link to="/playground" className="btn-secondary group">
                <Play className="w-5 h-5 mr-2" />
                Try Playground
              </Link>
              <a
                href="https://bluelibs.github.io/runner/"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary group"
              >
                API Reference
              </a>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 sm:gap-12 mb-20 sm:mb-28">
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-blue-600 dark:text-blue-400">
                  2.49M
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Tasks/sec
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400">
                  100%
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Test Coverage
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-purple-600 dark:text-purple-400">
                  0ms
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Magic Overhead
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-pink-600 dark:text-pink-400">
                  Simple
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Dependency Injection
                </div>
              </div>
            </div>

            {/* Code Preview */}
            <div className="max-w-4xl mx-auto">
              <div className="card p-4 sm:p-6">
                <div className="text-left">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Quick Example
                    </h3>
                    <div className="flex space-x-2">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    </div>
                  </div>
                  <CodeBlock>
                    {`import { resource, task, run } from "@bluelibs/runner";

const server = resource({
  id: "app.server",
  init: async ({ port }: { port: number }) => {
    const app = express();
    return app.listen(port);
  }
});

const createUser = task({
  id: "app.tasks.createUser",
  dependencies: { server },
  run: async (userData, { server }) => {
    // Your business logic here
    return { id: "user-123", ...userData };
  }
});

// That's it. Clean, simple, testable.
const { dispose, value } = await run(server);`}
                  </CodeBlock>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-32 bg-white/50 dark:bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              The Big Five
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              Understanding these five concepts is key to using Runner
              effectively. They're not just buzzwords – they're the building
              blocks of maintainable applications.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
            {features.map((feature, index) => (
              <div
                key={index}
                className={`card p-10 transition-all duration-300 ${
                  hoveredFeature === index ? "scale-105 shadow-2xl" : ""
                }`}
                onMouseEnter={() => setHoveredFeature(index)}
                onMouseLeave={() => setHoveredFeature(null)}
              >
                <div className="flex items-start space-x-6 mb-12">
                  <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                      {feature.title}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-300">
                      {feature.description}
                    </p>
                    <div className="mt-3">
                      <Link
                        to={`/docs#${feature.docAnchor}`}
                        className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                      >
                        Learn more
                        <ArrowRight className="w-4 h-4 ml-1" />
                      </Link>
                    </div>
                  </div>
                </div>
                <div className="overflow-hidden">
                  <CodeBlock>{feature.example}</CodeBlock>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Performance Section */}
      <section className="py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              <Gauge className="w-8 h-8 inline-block mr-2" />
              Built for Performance
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              Real benchmarks from our comprehensive test suite. These aren't
              marketing numbers – they're what you'll actually see in
              production.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-20">
            {benchmarks.map((benchmark, index) => (
              <div key={index} className="card p-8 text-center">
                <div
                  className={`w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r ${benchmark.color} flex items-center justify-center`}
                >
                  <TrendingUp className="w-8 h-8 text-white" />
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  {benchmark.value}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {benchmark.label}
                </div>
              </div>
            ))}
          </div>

          <div className="text-center">
            <Link to="/benchmarks" className="btn-primary">
              <Timer className="w-5 h-5 mr-2" />
              See All Benchmarks
            </Link>
          </div>
        </div>
      </section>

      {/* TL;DR Section */}
      <section className="py-32 bg-white/50 dark:bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              TL;DR
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
              The essentials from the minimal guide.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-16">
            <div className="card p-10">
              <div className="font-semibold text-gray-900 dark:text-white mb-2">
                Lifecycle
              </div>
              <div className="text-gray-700 dark:text-gray-300 text-sm">
                <code>run()</code> → <code>ready</code> event →{" "}
                <code>dispose()</code>
              </div>
              <div className="mt-3">
                <Link
                  to="/docs#quick-start"
                  className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                >
                  Learn more
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </div>
            </div>
            <div className="card p-10">
              <div className="font-semibold text-gray-900 dark:text-white mb-2">
                Tasks
              </div>
              <div className="text-gray-700 dark:text-gray-300 text-sm">
                Functions with DI + middleware; validate input/result.
              </div>
              <div className="mt-3">
                <Link
                  to="/docs#tasks"
                  className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                >
                  Learn more
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </div>
            </div>
            <div className="card p-10">
              <div className="font-semibold text-gray-900 dark:text-white mb-2">
                Resources
              </div>
              <div className="text-gray-700 dark:text-gray-300 text-sm">
                Managed singletons (init/dispose) for services and state.
              </div>
              <div className="mt-3">
                <Link
                  to="/docs#resources"
                  className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                >
                  Learn more
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <div className="card p-10">
              <div className="font-semibold text-gray-900 dark:text-white mb-2">
                Events & Hooks
              </div>
              <div className="text-gray-700 dark:text-gray-300 text-sm">
                Emit → validate → ordered hooks run; use{" "}
                <code>stopPropagation()</code>.
              </div>
              <div className="mt-3">
                <Link
                  to="/docs#events"
                  className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                >
                  Learn more
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </div>
            </div>
            <div className="card p-10">
              <div className="font-semibold text-gray-900 dark:text-white mb-2">
                Middleware
              </div>
              <div className="text-gray-700 dark:text-gray-300 text-sm">
                Retry, timeout, cache, auth; async and awaited.
              </div>
              <div className="mt-3">
                <Link
                  to="/docs#middleware"
                  className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                >
                  Learn more
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </div>
            </div>
            <div className="card p-10">
              <div className="font-semibold text-gray-900 dark:text-white mb-2">
                Concurrency
              </div>
              <div className="text-gray-700 dark:text-gray-300 text-sm">
                <code>Semaphore</code> for limits, <code>Queue</code> for FIFO +
                cancel.
              </div>
              <div className="mt-3">
                <Link
                  to="/docs#concurrency"
                  className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                >
                  Learn more
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Section */}
      <section className="py-32 bg-white/50 dark:bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-12">
                Why Choose Runner?
              </h2>
              <div className="space-y-8">
                {[
                  "No magic, no surprises — explicit beats implicit",
                  "TypeScript-first with zero compromise on type safety",
                  "High performance — 2.49M+ tasks per second",
                  "Enterprise ready with graceful shutdown & error boundaries",
                  "Structured logging, caching, retry, and timeouts built-in",
                  "Functional style with simple dependency injection",
                  "Optional validation for inputs, results, configs, payloads",
                  "Concurrency primitives: Semaphore & Queue",
                ].map((feature, index) => (
                  <div key={index} className="flex items-start space-x-3">
                    <Check className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-600 dark:text-gray-300">
                      {feature}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-12">
                <Link to="/docs" className="btn-primary">
                  Read the Docs
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Link>
              </div>
            </div>
            <div className="card p-10">
              <div className="text-gray-500 dark:text-gray-400 text-sm mb-4 flex items-center justify-between">
                <span>From the author:</span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 dark:text-gray-400 text-xs">
                    {quoteIndex + 1} / {authorQuotes.length}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setQuoteIndex(
                          (i) =>
                            (i - 1 + authorQuotes.length) % authorQuotes.length,
                        )
                      }
                      className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition text-xs"
                      aria-label="Previous quote"
                      title="Previous quote"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setQuoteIndex(
                          Math.floor(Math.random() * authorQuotes.length),
                        )
                      }
                      className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition text-xs"
                      aria-label="Random quote"
                      title="Random quote"
                    >
                      <Shuffle className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setQuoteIndex((i) => (i + 1) % authorQuotes.length)
                      }
                      className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition text-xs"
                      aria-label="Next quote"
                      title="Next quote"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-start space-x-3 mb-4">
                {(() => {
                  const QuoteIcon = getRandomIcon(quoteIndex);
                  return (
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                      <QuoteIcon className="w-4 h-4 text-white" />
                    </div>
                  );
                })()}
                <blockquote className="text-lg text-gray-900 dark:text-white">
                  "{authorQuotes[quoteIndex]}"
                </blockquote>
              </div>
              <div className="flex justify-end">
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <div className="w-6 h-6 bg-gradient-to-br from-purple-500 via-blue-500 to-green-400 rounded-full flex items-center justify-center">
                      <Brain className="w-3 h-3 text-white" />
                    </div>
                    <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full flex items-center justify-center">
                      <Lightning className="w-1.5 h-1.5 text-white" />
                    </div>
                    <div className="absolute -bottom-0 -left-0 w-2 h-2 bg-gradient-to-r from-pink-400 to-red-400 rounded-full flex items-center justify-center">
                      <Coffee className="w-1 h-1 text-white" />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-light text-gray-600 dark:text-gray-400 tracking-wide">
                      Theodor Diaconu
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500 font-extralight italic">
                      Author of Runner
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-32">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-8">
            Ready to Stop Worrying?
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-12">
            Join thousands of developers who've already made the switch to
            cleaner, more maintainable TypeScript applications.
          </p>
          <div className="flex flex-col sm:flex-row gap-6 justify-center">
            <Link to="/quick-start" className="btn-primary text-lg px-8 py-4">
              <Zap className="w-6 h-6 mr-2" />
              Get Started Now
            </Link>
            <a
              href="https://github.com/bluelibs/runner"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-lg px-8 py-4"
            >
              <GitBranch className="w-6 h-6 mr-2" />
              View on GitHub
            </a>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
