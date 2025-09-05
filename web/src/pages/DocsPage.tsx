import {
  Book,
  Zap,
  Shield,
  Timer,
  Rocket,
  Activity,
  CheckCircle,
  ArrowRight,
} from "lucide-react";
import DocsLayout from "../components/docs/DocsLayout";
import ConceptCard from "../components/docs/ConceptCard";
import { allDocSections, conceptIcons } from "../data/documentation";
import { codeExamples } from "../data/codeExamples";
import Meta from "../components/Meta";
import CodeBlock from "../components/CodeBlock";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const DocsPage: React.FC = () => {
  const location = useLocation();

  // Ensure deep links like /docs#middleware scroll to the correct section
  useEffect(() => {
    const hash = location.hash?.replace(/^#/, "");
    if (!hash) return;
    // Defer until after paint so the element is in the DOM
    const id = decodeURIComponent(hash);
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    // Try immediately and on next frame to handle async layouts
    tryScroll();
    const raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [location.hash]);

  return (
    <DocsLayout
      title="Documentation"
      description="Comprehensive guides and API reference for Runner. Everything you need to build production-ready applications."
      sidebarSections={allDocSections}
    >
      <Meta
        title="Runner Docs — Concepts, Guides, API"
        description="Learn Runner's core concepts (tasks, resources, events, middleware), advanced features, enterprise patterns, and execution model."
      />
      {/* Quick Start: define → register → run */}
      <section id="quick-start" className="scroll-mt-24">
        <div className="card p-8 mb-12">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Rocket className="w-8 h-8 mr-3" />
            Quick Start: define → register → run
          </h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            The core pattern in Runner is simple: you{" "}
            <strong>define</strong> your application parts (tasks, resources),
            <strong>register</strong> them to let the system know they exist,
            and then <strong>run</strong> the whole application. Registration is
            key—it’s how Runner builds the dependency graph and enables all its
            powerful features.
          </p>
          <CodeBlock>{codeExamples.tasksQuickStart}</CodeBlock>
        </div>
      </section>

      {/* The Big Picture */}
      <section id="the-big-picture" className="scroll-mt-24">
        <div className="card p-8 mb-12">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Book className="w-8 h-8 mr-3" />
            The Big Picture: A Mental Model
          </h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            Before diving into the details, let's zoom out. Runner is built on
            a simple idea called <strong>Inversion of Control (IoC)</strong>,
            also known as Dependency Injection.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            Instead of your code creating its own dependencies (like a database
            connection or a logger), you declare what you need, and Runner
            provides them for you. This makes your code more modular, easier to
            test, and simpler to manage.
          </p>
          <h4 className="text-lg font-semibold text-gray-900 dark:text-white mt-6 mb-2">
            The Application Lifecycle
          </h4>
          <ol className="list-decimal list-inside space-y-2 text-gray-600 dark:text-gray-300">
            <li>
              <strong>run()</strong>: You start the application. Runner reads
              all your definitions and builds a dependency tree.
            </li>
            <li>
              <strong>init()</strong>: Runner initializes all registered{" "}
              <strong>resources</strong> in the correct order. This is where
              database connections are made and services are started.
            </li>
            <li>
              <strong>Ready</strong>: The system is now running and ready to
              execute <strong>tasks</strong> or handle <strong>events</strong>.
            </li>
            <li>
              <strong>dispose()</strong>: When the application shuts down,
              Runner calls the <code>dispose()</code> method on all resources in
              reverse order, ensuring a graceful cleanup.
            </li>
          </ol>
        </div>
      </section>

      {/* TL;DR */}
      <section id="tldr" className="scroll-mt-24">
        <div className="card p-8 mb-12">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Rocket className="w-8 h-8 mr-3" />
            TL;DR
          </h2>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-gray-700 dark:text-gray-300">
            <li>
              <strong>Lifecycle</strong>: Your app boots with{" "}
              <code>run()</code>, becomes operational after the{" "}
              <code>ready</code> event, and cleans up with <code>dispose()</code>
              .
            </li>
            <li>
              <strong>Tasks</strong>: These are your functions that do the work.
              They get their dependencies automatically and can be wrapped with
              middleware.
            </li>
            <li>
              <strong>Resources</strong>: These are your shared, long-lived
              objects like database connections or services. Runner manages
              their creation and destruction.
            </li>
            <li>
              <strong>Events</strong>: A way to signal that something happened
              (e.g., "user signed up").
            </li>
            <li>
              <strong>Hooks</strong>: Functions that listen for specific events
              and run in response.
            </li>
            <li>
              <strong>Middleware</strong>: Wrappers that add extra behavior to
              your tasks and resources, like logging or authentication.
            </li>
          </ul>
        </div>
      </section>
      {/* Core Concepts */}
      <section id="core-concepts" className="scroll-mt-24">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-8 flex items-center">
          <Book className="w-8 h-8 mr-3" />
          Core Concepts
        </h2>

        <div id="tasks" className="card p-8 mb-8 scroll-mt-24">
          <div className="flex items-start space-x-4 mb-6">
            <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
              {conceptIcons.tasks && (
                <conceptIcons.tasks className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center">
                Tasks
                <a
                  href="#tasks"
                  className="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  #
                </a>
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                <strong>Analogy</strong>: Think of a task as a recipe for a
                specific action, like "Bake a Cake" or "Register a User". It
                lists the ingredients it needs (dependencies) and provides
                step-by-step instructions (the <code>run</code> function).
              </p>
              <a
                href="https://bluelibs.github.io/runner/#md:tasks"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mt-2"
              >
                View API Reference <ArrowRight className="w-4 h-4 ml-1" />
              </a>
            </div>
          </div>
          <CodeBlock>{codeExamples.tasks}</CodeBlock>
          <div className="space-y-4 mt-6">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              Why use a Task (instead of a regular function)?
            </h4>
            <ul className="space-y-2 text-gray-600 dark:text-gray-300 list-disc list-inside">
              <li>
                <strong>Automatic Dependencies</strong>: Just declare what you
                need (like <code>emailService</code>), and Runner provides it.
                This makes your code cleaner.
              </li>
              <li>
                <strong>Easy to Test</strong>: Because dependencies are passed
                in, you can easily provide mock versions in your tests, as shown
                in the example.
              </li>
              <li>
                <strong>Middleware</strong>: You can wrap tasks with middleware
                for caching, authentication, logging, etc., without changing the
                task's code.
              </li>
            </ul>
          </div>
        </div>

        <div id="resources" className="card p-8 mb-8 scroll-mt-24">
          <div className="flex items-start space-x-4 mb-6">
            <div className="w-12 h-12 bg-gradient-to-r from-green-500 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              {conceptIcons.resources && (
                <conceptIcons.resources className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center">
                Resources
                <a
                  href="#resources"
                  className="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  #
                </a>
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                <strong>Analogy</strong>: A resource is like a shared, heavy-duty
                tool in a workshop, such as a table saw or a drill press. You
                set it up once (<code>init</code>), use it many times across
                different projects (tasks), and then properly shut it down at
                the end of the day (<code>dispose</code>).
              </p>
              <a
                href="https://bluelibs.github.io/runner/#md:resources"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mt-2"
              >
                View API Reference <ArrowRight className="w-4 h-4 ml-1" />
              </a>
            </div>
          </div>
          <CodeBlock>{codeExamples.resources}</CodeBlock>
          <div className="space-y-4 mt-6">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              Why use a Resource?
            </h4>
            <ul className="space-y-2 text-gray-600 dark:text-gray-300 list-disc list-inside">
              <li>
                <strong>Managed Lifecycle</strong>: Runner handles the setup (
                <code>init</code>) and teardown (<code>dispose</code>) for you,
                preventing resource leaks.
              </li>
              <li>
                <strong>Singleton Pattern</strong>: A resource is created only
                once and shared everywhere. This is efficient for expensive
                objects like database connections.
              </li>
              <li>
                <strong>Configuration</strong>: You can pass type-safe
                configuration to resources, making them flexible and reusable.
              </li>
            </ul>
            <CodeBlock>
              {`const server = resource({
  id: "app.server",
  // This function receives the config you provide below
  init: async (config: { port: number; host: string }) => {
    const app = express();
    return app.listen(config.port, config.host);
  },
  dispose: async (server) => server.close(),
});

// Register the resource with its configuration
const app = resource({
  id: "app",
  register: [
    server.with({ port: 3000, host: "localhost" })
  ],
});`}
            </CodeBlock>
          </div>
        </div>

        {/* Connecting the Dots */}
        <div className="card p-8 mb-8 bg-blue-50 dark:bg-blue-900/20">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            Connecting the Dots: How They Work Together
          </h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            The core concepts are designed to fit together seamlessly. Here's a
            typical flow:
          </p>
          <div className="text-center text-gray-600 dark:text-gray-400 font-mono">
            <p>
              A <strong>Task</strong> (e.g., `registerUser`) needs to do its job.
            </p>
            <p className="text-2xl my-2">↓</p>
            <p>
              It depends on a <strong>Resource</strong> (e.g., `database`) to
              save the user.
            </p>
            <p className="text-2xl my-2">↓</p>
            <p>
              After saving, the <strong>Task</strong> emits an{" "}
              <strong>Event</strong> (e.g., `userRegistered`).
            </p>
            <p className="text-2xl my-2">↓</p>
            <p>
              A <strong>Hook</strong> (e.g., `sendWelcomeEmail`) is listening for
              that <strong>Event</strong> and runs automatically.
            </p>
          </div>
          <p className="text-gray-700 dark:text-gray-300 mt-4">
            This pattern keeps your code decoupled. The registration task
            doesn't need to know about sending emails; it just announces that a
            user has registered.
          </p>
        </div>

        <div id="events" className="card p-8 mb-8 scroll-mt-24">
          <div className="flex items-start space-x-4 mb-6">
            <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0">
              {conceptIcons.events && (
                <conceptIcons.events className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center">
                Events
                <a
                  href="#events"
                  className="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  #
                </a>
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                <strong>Analogy</strong>: An event is like a public announcement
                or a flare gun. You fire it to signal that something important
                has happened (like "User Registered!"), without knowing or
                caring who is listening.
              </p>
              <a
                href="https://bluelibs.github.io/runner/#md:events"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mt-2"
              >
                View API Reference <ArrowRight className="w-4 h-4 ml-1" />
              </a>
            </div>
          </div>
          <CodeBlock>{codeExamples.events}</CodeBlock>
          <div className="space-y-4 mt-6">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              Why use Events?
            </h4>
            <ul className="space-y-2 text-gray-600 dark:text-gray-300 list-disc list-inside">
              <li>
                <strong>Decoupling</strong>: The part of your code that creates
                an event doesn't need to know what will happen next. This makes
                it easy to add new functionality later without changing existing
                code.
              </li>
              <li>
                <strong>Extensibility</strong>: Other developers (or even other
                modules) can listen for your events and add their own logic.
              </li>
            </ul>
          </div>
        </div>

        <div id="hooks" className="card p-8 mb-8 scroll-mt-24">
          <div className="flex items-start space-x-4 mb-6">
            <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
              {conceptIcons.hooks && (
                <conceptIcons.hooks className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center">
                Hooks
                <a
                  href="#hooks"
                  className="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  #
                </a>
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                <strong>Analogy</strong>: If an event is an announcement, a hook
                is the person assigned to listen for that specific announcement
                and perform an action. For example, when they hear "User
                Registered!", their job is to send a welcome email.
              </p>
              <a
                href="https://bluelibs.github.io/runner/#md:hooks"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mt-2"
              >
                View API Reference <ArrowRight className="w-4 h-4 ml-1" />
              </a>
            </div>
          </div>
          <CodeBlock>{codeExamples.hooks}</CodeBlock>
          <div className="space-y-4 mt-6">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              Why use Hooks?
            </h4>
            <ul className="space-y-2 text-gray-600 dark:text-gray-300 list-disc list-inside">
              <li>
                <strong>Reactive Logic</strong>: Hooks are perfect for running
                side-effects in response to events, like sending notifications,
                logging, or updating other systems.
              </li>
              <li>
                <strong>Lightweight</strong>: They are simpler and more
                lightweight than tasks, designed specifically for event
                handling.
              </li>
            </ul>
          </div>
        </div>

        <div id="middleware" className="card p-8 mb-8 scroll-mt-24">
          <div className="flex items-start space-x-4 mb-6">
            <div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
              {conceptIcons.middleware && (
                <conceptIcons.middleware className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 flex items-center">
                Middleware
                <a
                  href="#middleware"
                  className="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  #
                </a>
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                <strong>Analogy</strong>: Middleware is like a series of security
                checkpoints or quality control stations that your task's request
                must pass through. Each station can inspect the request, add to
                it, or even turn it away before it reaches its final
                destination (the task's <code>run</code> logic).
              </p>
              <a
                href="https://bluelibs.github.io/runner/#md:middleware"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mt-2"
              >
                View API Reference <ArrowRight className="w-4 h-4 ml-1" />
              </a>
            </div>
          </div>

          <div className="space-y-6">
            {/* Task Middleware */}
            <div>
              <h4 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                Task Middleware
                <a
                  href="#middleware"
                  className="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Task Middleware anchor"
                >
                  #
                </a>
              </h4>
              <p className="text-gray-600 dark:text-gray-300 mb-3">
                Runs "around" a task's execution. It's perfect for handling
                cross-cutting concerns that apply to many tasks.
              </p>
              <CodeBlock>{codeExamples.middlewareTaskAuth}</CodeBlock>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className="space-y-2">
                  <h5 className="font-semibold text-gray-900 dark:text-white">
                    Common Use Cases
                  </h5>
                  <ul className="text-gray-600 dark:text-gray-300 list-disc list-inside">
                    <li>Authentication & Authorization</li>
                    <li>Caching results</li>
                    <li>Retrying failed operations</li>
                    <li>Logging and performance monitoring</li>
                  </ul>
                  <CodeBlock>{codeExamples.middlewareResilientTask}</CodeBlock>
                </div>
                <div className="space-y-2">
                  <h5 className="font-semibold text-gray-900 dark:text-white">
                    Global Middleware
                  </h5>
                  <p className="text-gray-600 dark:text-gray-300">
                    You can apply middleware to all tasks at once using the{" "}
                    <code>everywhere</code> flag.
                  </p>
                  <CodeBlock>{codeExamples.middlewareGlobalTask}</CodeBlock>
                </div>
              </div>
            </div>

            {/* Resource Middleware */}
            <div>
              <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                Resource Middleware
              </h4>
              <p className="text-gray-600 dark:text-gray-300 mb-3">
                Wraps a resource's initialization. This is more advanced, but it
                can be used to dynamically modify a resource's behavior. For
                example, you could add a "soft delete" feature to a database
                service.
              </p>
              <CodeBlock>{codeExamples.middlewareResourceSoftDelete}</CodeBlock>
            </div>
          </div>
        </div>
        <ConceptCard
          id="tags"
          title="Tags"
          icon={conceptIcons.tags}
          iconBgGradient="bg-gradient-to-r from-fuchsia-500 to-pink-600"
          description="Typed metadata and contracts for tasks/resources. Use tags for discovery, wiring, and enforcing output contracts."
          codeExample={codeExamples.metaAndTags}
          apiHref="https://bluelibs.github.io/runner/#md:tags"
          className="mt-8"
        >
          <div className="space-y-3">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              Great for
            </h4>
            <ul className="list-disc ml-6 text-gray-700 dark:text-gray-300 space-y-1">
              <li>
                <span className="font-semibold">Contracts:</span> enforce
                expected outputs by tagging tasks/resources with type contracts.
              </li>
              <li>
                <span className="font-semibold">Discovery:</span> find
                components at runtime via{" "}
                <code>store.getTasksWithTag(tag)</code>
                and <code>store.getResourcesWithTag(tag)</code> in a
                <code>ready</code> hook.
              </li>
              <li>
                <span className="font-semibold">Wiring:</span> programmatically
                intercept tasks or register routes based on tag configuration
                (see route wiring pattern).
              </li>
              <li>
                <span className="font-semibold">Config:</span> pass structured
                options with <code>tag.with(config)</code> and read them via
                <code>tag.extract(...)</code>.
              </li>
              <li>
                <span className="font-semibold">Scoping & observability:</span>
                use <code>globals.tags.excludeFromGlobalHooks</code> to limit
                wildcard listeners and <code>globals.tags.debug</code> to add
                targeted debugging.
              </li>
            </ul>
          </div>
        </ConceptCard>
        <ConceptCard
          id="di-guarantees"
          title="DI Guarantees"
          icon={Shield}
          iconBgGradient="bg-gradient-to-r from-emerald-500 to-teal-600"
          description="Predictable behavior by design: circular dependency protection and deterministic override precedence."
          className="mt-8"
        >
          <ul className="list-disc ml-6 text-gray-700 dark:text-gray-300 space-y-2">
            <li>
              <span className="font-semibold">Circular Dependencies:</span>{" "}
              fatal at runtime with a descriptive chain (A → B → A).
            </li>
            <li>
              <span className="font-semibold">Override Precedence:</span>{" "}
              top‑down; the override closest to <code>run()</code> wins.
            </li>
          </ul>
        </ConceptCard>
      </section>

      {/* Execution */}
      <section id="execution" className="scroll-mt-24">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-8 flex items-center">
          <Rocket className="w-8 h-8 mr-3" />
          Execution
        </h2>
        <ConceptCard
          id="run-options"
          title="run() and RunOptions"
          icon={conceptIcons["run-options"]}
          iconBgGradient="bg-gradient-to-r from-green-500 to-teal-600"
          description="The run() function boots a root resource and returns a handle to interact with your system. It can be configured with various options."
          codeExample={codeExamples.runOptions}
          apiHref="https://bluelibs.github.io/runner/#md:run-and-runoptions"
          className="mb-8"
        >
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              Available options
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200/20 dark:border-gray-700/50">
                    <th className="text-left py-3 px-2 font-semibold text-gray-900 dark:text-white">
                      Option
                    </th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-900 dark:text-white">
                      Default
                    </th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-900 dark:text-white">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-300">
                  <tr className="border-b border-gray-200/10 dark:border-gray-700/30">
                    <td className="py-3 px-2">
                      <code>debug?</code>
                    </td>
                    <td className="py-3 px-2">
                      <code>undefined</code>
                    </td>
                    <td className="py-3 px-2">
                      Enables rich debug output and hooks into the Debug
                      resource for development visibility.
                    </td>
                  </tr>
                  <tr className="border-b border-gray-200/10 dark:border-gray-700/30">
                    <td className="py-3 px-2">
                      <code>logs?.printThreshold?</code>
                    </td>
                    <td className="py-3 px-2">
                      <code>info</code>
                    </td>
                    <td className="py-3 px-2">
                      Log level threshold for printing. Use <code>null</code> to
                      disable.
                    </td>
                  </tr>
                  <tr className="border-b border-gray-200/10 dark:border-gray-700/30">
                    <td className="py-3 px-2">
                      <code>logs?.printStrategy?</code>
                    </td>
                    <td className="py-3 px-2">
                      <code>PRETTY</code>
                    </td>
                    <td className="py-3 px-2">How to format log output.</td>
                  </tr>
                  <tr className="border-b border-gray-200/10 dark:border-gray-700/30">
                    <td className="py-3 px-2">
                      <code>logs?.bufferLogs?</code>
                    </td>
                    <td className="py-3 px-2">
                      <code>false</code>
                    </td>
                    <td className="py-3 px-2">
                      Buffer logs until the root resource is ready.
                    </td>
                  </tr>
                  <tr className="border-b border-gray-200/10 dark:border-gray-700/30">
                    <td className="py-3 px-2">
                      <code>errorBoundary?</code>
                    </td>
                    <td className="py-3 px-2">
                      <code>true</code>
                    </td>
                    <td className="py-3 px-2">
                      Installs a central error boundary for uncaught errors
                      routed to <code>onUnhandledError</code>.
                    </td>
                  </tr>
                  <tr className="border-b border-gray-200/10 dark:border-gray-700/30">
                    <td className="py-3 px-2">
                      <code>shutdownHooks?</code>
                    </td>
                    <td className="py-3 px-2">
                      <code>true</code>
                    </td>
                    <td className="py-3 px-2">
                      Installs SIGINT/SIGTERM handlers that call{" "}
                      <code>dispose()</code> for graceful shutdown.
                    </td>
                  </tr>
                  <tr className="border-b border-gray-200/10 dark:border-gray-700/30">
                    <td className="py-3 px-2">
                      <code>onUnhandledError?</code>
                    </td>
                    <td className="py-3 px-2">logger</td>
                    <td className="py-3 px-2">
                      Custom handler for any unhandled error; defaults to
                      logging via the created logger.
                    </td>
                  </tr>
                  <tr className="border-b border-gray-200/10 dark:border-gray-700/30">
                    <td className="py-3 px-2">
                      <code>dryRun?</code>
                    </td>
                    <td className="py-3 px-2">
                      <code>false</code>
                    </td>
                    <td className="py-3 px-2">
                      Validates setup without starting: resources aren't
                      initialized and no events are emitted.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-2">
                      <code>runtimeCycleDetection?</code>
                    </td>
                    <td className="py-3 px-2">
                      <code>true</code>
                    </td>
                    <td className="py-3 px-2">
                      Forces runtime cycle detection for event emissions;
                      disable to improve performance if you're sure there are no
                      deadlocks.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </ConceptCard>
      </section>

      {/* Advanced Features */}
      <section id="advanced" className="scroll-mt-24">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-8 flex items-center">
          <Zap className="w-8 h-8 mr-3" />
          Advanced Features
        </h2>
        <div className="card p-6 mb-8 bg-yellow-50 dark:bg-yellow-900/20">
          <p className="text-gray-800 dark:text-yellow-200">
            <strong>Good to know</strong>: You won't need these features when
            you're just starting out. Focus on the Core Concepts first, and come
            back here when you have a specific problem to solve!
          </p>
        </div>

        <ConceptCard
          id="context"
          title="Context"
          icon={conceptIcons.context}
          iconBgGradient="bg-gradient-to-r from-indigo-500 to-purple-600"
          description='Problem: Ever needed to pass a "request ID" or user information through many layers of your app? Passing it as an argument everywhere is tedious. Solution: Context provides a "magical" way to make data available to all functions in a specific async chain, without prop drilling.'
          codeExample={codeExamples.context}
          apiHref="https://bluelibs.github.io/runner/#md:context"
          className="mb-8"
        />

        <ConceptCard
          id="interceptors"
          title="Interceptors"
          icon={conceptIcons.interceptors}
          iconBgGradient="bg-gradient-to-r from-blue-500 to-purple-600"
          description="Problem: How can you peek into a task's execution, or even change its behavior from the outside? Solution: Interceptors let you wrap a task's run logic at runtime. This is perfect for fine-grained logging, metrics, or adding dynamic checks."
          codeExample={codeExamples.interceptors}
          apiHref="https://bluelibs.github.io/runner/#md:task-interceptors"
          className="mb-8"
        />

        <ConceptCard
          id="optional-deps"
          title="Optional Dependencies"
          icon={conceptIcons["optional-deps"]}
          iconBgGradient="bg-gradient-to-r from-green-500 to-blue-600"
          description="Problem: What if your app uses an external service for a non-critical feature (like analytics), and that service goes down? You don't want your whole app to crash. Solution: Mark the dependency as optional, and your code can gracefully handle cases where it's not available."
          codeExample={codeExamples.optionalDeps}
          className="mb-8"
        />

        {/* Tags moved to Core Concepts */}

        <ConceptCard
          id="overrides"
          title="Overrides"
          icon={conceptIcons.overrides}
          iconBgGradient="bg-gradient-to-r from-amber-500 to-orange-600"
          description="Problem: How do you use a fake email service in your tests, or a different implementation in development vs. production? Solution: Overrides let you swap out a resource or task's implementation without changing its ID. It's a clean way to handle test doubles and environment-specific logic."
          codeExample={codeExamples.overrides}
          apiHref="https://bluelibs.github.io/runner/#md:overrides"
          className="mb-8"
        />

        <ConceptCard
          id="validation"
          title="Validation"
          icon={CheckCircle}
          iconBgGradient="bg-gradient-to-r from-green-500 to-emerald-600"
          description="Optional, library‑agnostic schemas for inputs, results, configs, and payloads. Works great with Zod; adaptable to Yup/Joi."
          codeExample={`import { z } from "zod";

const input = z.object({ email: z.string().email() });
const output = z.object({ id: z.string(), email: z.string().email() });

task({ id: "app.t", inputSchema: input, resultSchema: output });
resource({ id: "r", configSchema: z.object({ url: z.string().url() }) });
event({ id: "e", payloadSchema: z.object({ id: z.string() }) });
middleware({ id: "m", configSchema: z.object({ retries: z.number() }) });`}
          apiHref="https://bluelibs.github.io/runner/#md:runtime-validation"
          className="mb-8"
        />

        <div id="event-cycle" className="card p-8 mb-8">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            Event Cycle Safety
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-3">
            The runner detects cycles during emission to prevent deadlocks (for
            example, <code>e1 → e2 → e1</code> in the same chain).
          </p>
          <ul className="list-disc ml-6 text-gray-700 dark:text-gray-300 space-y-1">
            <li>Readable error with the full emission chain</li>
            <li>Same‑hook re‑emits allowed only for idempotent cases</li>
            <li>
              Prefer one‑way flows; use <code>stopPropagation()</code> when
              needed
            </li>
          </ul>
        </div>

        <ConceptCard
          id="debug-resource"
          title="Debug Resource"
          icon={conceptIcons["debug-resource"]}
          iconBgGradient="bg-gradient-to-r from-orange-500 to-red-600"
          description="A powerful observability suite that hooks into the framework's execution pipeline to provide detailed insights into your application's behavior."
          codeExample={codeExamples.debugResource}
          apiHref="https://bluelibs.github.io/runner/#md:debug-resource"
        />

        <ConceptCard
          id="testing"
          title="Testing"
          icon={conceptIcons.testing}
          iconBgGradient="bg-gradient-to-r from-sky-500 to-indigo-600"
          description="Use run() as a minimal, full‑stack test harness: run tasks, emit events, and access resource values. Layer overrides for test doubles."
          codeExample={codeExamples.testing}
          apiHref="https://bluelibs.github.io/runner/#md:testing"
          className="mt-8"
        />
      </section>

      {/* Enterprise Features */}
      <section id="enterprise" className="scroll-mt-24">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-8 flex items-center">
          <Shield className="w-8 h-8 mr-3" />
          Enterprise Features
        </h2>

        <ConceptCard
          id="logging"
          title="Logging"
          icon={conceptIcons.logging}
          iconBgGradient="bg-gradient-to-r from-green-500 to-teal-600"
          description="Structured logging with automatic context injection. Every log entry includes execution context, timing, and metadata."
          codeExample={codeExamples.logging}
          apiHref="https://bluelibs.github.io/runner/#md:logging"
          className="mb-8"
        />

        <ConceptCard
          id="caching"
          title="Caching"
          icon={conceptIcons.caching}
          iconBgGradient="bg-gradient-to-r from-blue-500 to-cyan-600"
          description="Built-in LRU and custom cache providers. Automatic cache invalidation and warming strategies."
          codeExample={codeExamples.caching}
          apiHref="https://bluelibs.github.io/runner/#md:caching"
          className="mb-8"
        >
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              Override Cache Factory
            </h4>
            <p className="text-gray-600 dark:text-gray-300">
              You can override the default in-memory cache with your own
              implementation, for example, to use Redis.
            </p>
          </div>
        </ConceptCard>

        <ConceptCard
          id="retries"
          title="Retries"
          icon={conceptIcons.retries}
          iconBgGradient="bg-gradient-to-r from-orange-500 to-red-600"
          description="Automatic retry with exponential backoff, jitter, and circuit breaker patterns for resilient operations."
          codeExample={codeExamples.retries}
          apiHref="https://bluelibs.github.io/runner/#md:retrying-failed-operations"
          className="mb-8"
        />

        <ConceptCard
          id="timeouts"
          title="Timeouts"
          icon={conceptIcons.timeouts}
          iconBgGradient="bg-gradient-to-r from-purple-500 to-pink-600"
          description="Operation timeout management with graceful degradation and cleanup handlers."
          codeExample={codeExamples.timeouts}
          apiHref="https://bluelibs.github.io/runner/#md:timeouts"
          className="mb-8"
        />

        <ConceptCard
          id="shutdown"
          title="System Shutdown"
          icon={conceptIcons.shutdown}
          iconBgGradient="bg-gradient-to-r from-green-500 to-teal-600"
          description="Graceful shutdown and cleanup when your app needs to stop."
          codeExample={codeExamples.shutdown}
          apiHref="https://bluelibs.github.io/runner/#md:system-shutdown-hooks"
          className="mb-8"
        />

        <ConceptCard
          id="unhandled-errors"
          title="Unhandled Errors"
          icon={conceptIcons["unhandled-errors"]}
          iconBgGradient="bg-gradient-to-r from-blue-500 to-cyan-600"
          description="The onUnhandledError callback is invoked by Runner whenever an error escapes normal handling."
          codeExample={codeExamples.unhandledErrors}
          apiHref="https://bluelibs.github.io/runner/#md:unhandled-errors"
        />
      </section>

      {/* Performance */}
      <section id="performance" className="scroll-mt-24">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-8 flex items-center">
          <Timer className="w-8 h-8 mr-3" />
          Performance
        </h2>

        <ConceptCard
          id="benchmarks"
          title="Benchmarks"
          icon={conceptIcons.benchmarks}
          iconBgGradient="bg-gradient-to-r from-emerald-500 to-green-600"
          description="Real-world performance metrics showing 2.49M+ tasks per second with full middleware stack."
          className="mb-8"
        />

        <ConceptCard
          id="optimization"
          title="Optimization"
          icon={conceptIcons.optimization}
          iconBgGradient="bg-gradient-to-r from-blue-500 to-indigo-600"
          description="Best practices for high-performance applications: dependency tree optimization, lazy loading, and efficient resource management."
          className="mb-8"
        />

        <ConceptCard
          id="concurrency"
          title="Concurrency Primitives"
          icon={Activity}
          iconBgGradient="bg-gradient-to-r from-sky-500 to-blue-600"
          description="Control parallelism and ordering with Semaphore and Queue. Support cooperative cancellation and graceful disposal."
          codeExample={`import { Semaphore, Queue } from "@bluelibs/runner";

// Limit parallelism
const sem = new Semaphore(5);
await sem.withPermit(async () => doWork());

// FIFO + cancellation
const q = new Queue();
const result = await q.run(async (signal) => {
  signal.throwIfAborted();
  return await step();
});
await q.dispose({ cancel: true });`}
          apiHref="https://bluelibs.github.io/runner/#md:performance"
          className="mb-8"
        />

        <div id="monitoring" className="card p-8 mb-8 scroll-mt-24">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Monitoring
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Built-in performance monitoring with metrics collection and
            debugging tools.
          </p>
        </div>

        <div id="memory" className="card p-8 scroll-mt-24">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Memory Management
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Automatic resource lifecycle management with proper cleanup and
            garbage collection optimization.
          </p>
        </div>
      </section>

      {/* Glossary */}
      <section id="glossary" className="scroll-mt-24">
        <div className="card p-8 mb-12">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Book className="w-8 h-8 mr-3" />
            Glossary of Terms
          </h2>
          <ul className="space-y-4 text-gray-700 dark:text-gray-300">
            <li>
              <strong className="text-gray-900 dark:text-white">
                Dependency Injection (DI)
              </strong>
              : A design pattern where a component receives its dependencies
              from an external source rather than creating them itself. This is
              the core principle of Runner.
            </li>
            <li>
              <strong className="text-gray-900 dark:text-white">
                Inversion of Control (IoC)
              </strong>
              : A broader principle where the framework (Runner) controls the
              flow of the program, calling your code rather than your code
              calling the framework. DI is a form of IoC.
            </li>
            <li>
              <strong className="text-gray-900 dark:text-white">
                Singleton
              </strong>
              : A design pattern that ensures a class has only one instance and
              provides a global point of access to it. Resources in Runner are
              singletons.
            </li>
            <li>
              <strong className="text-gray-900 dark:text-white">
                Decoupling
              </strong>
              : The practice of separating components so that they are not
              tightly connected. This makes the system more modular and easier
              to maintain. Events are a key tool for decoupling.
            </li>
            <li>
              <strong className="text-gray-900 dark:text-white">
                Cross-Cutting Concern
              </strong>
              : A feature that is needed in many different parts of an
              application, such as logging, security, or caching. Middleware is
              the primary way to handle these in Runner.
            </li>
          </ul>
        </div>
      </section>

      {/* External Links */}
      <section className="card p-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Additional Resources
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <a
            href="https://bluelibs.github.io/runner/"
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 border border-gray-200/20 dark:border-gray-700/50 rounded-lg hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors duration-200"
          >
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
              TypeDocs
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Complete API reference with TypeScript definitions
            </p>
          </a>
          <a
            href="https://github.com/bluelibs/runner/tree/main/examples"
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 border border-gray-200/20 dark:border-gray-700/50 rounded-lg hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors duration-200"
          >
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
              Examples
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Real-world examples and starter templates
            </p>
          </a>
          <a
            href="https://github.com/bluelibs/runner/blob/main/AI.md"
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 border border-gray-200/20 dark:border-gray-700/50 rounded-lg hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors duration-200"
          >
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
              AI‑Friendly Guide (AI.md)
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Minimal guide for quick reference: lifecycle, tasks, resources,
              events
            </p>
          </a>
        </div>
      </section>
    </DocsLayout>
  );
};

export default DocsPage;
