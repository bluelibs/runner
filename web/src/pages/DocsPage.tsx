import { Book, Zap, Shield, Timer, Rocket, Activity, CheckCircle } from "lucide-react";
import DocsLayout from "../components/docs/DocsLayout";
import ConceptCard from "../components/docs/ConceptCard";
import { allDocSections, conceptIcons } from "../data/documentation";
import { codeExamples } from "../data/codeExamples";
import Meta from "../components/Meta";

const DocsPage: React.FC = () => {
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
      {/* TL;DR */}
      <section id="tldr" className="scroll-mt-24">
        <div className="card p-8 mb-12">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Rocket className="w-8 h-8 mr-3" />
            TL;DR
          </h2>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-gray-700 dark:text-gray-300">
            <li>Lifecycle: <code>run() → ready event → dispose()</code></li>
            <li>Tasks: DI + middleware; validate input/result</li>
            <li>Resources: managed singletons with init/dispose</li>
            <li>Events: emit → validate → ordered hooks → run</li>
            <li>Hooks: async listeners; stoppable via <code>stopPropagation()</code></li>
            <li>Middleware: cross‑cutting concerns; async and awaited</li>
          </ul>
        </div>
      </section>
      {/* Core Concepts */}
      <section id="core-concepts" className="scroll-mt-24">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-8 flex items-center">
          <Book className="w-8 h-8 mr-3" />
          Core Concepts
        </h2>

        <ConceptCard
          id="tasks"
          title="Tasks"
          icon={conceptIcons.tasks}
          iconBgGradient="bg-gradient-to-r from-blue-500 to-purple-600"
          description="Tasks are functions with superpowers. They're pure-ish, testable, and composable. Unlike classes that accumulate methods like a hoarder accumulates stuff, tasks do one thing well."
          codeExample={codeExamples.tasks}
          apiHref="https://bluelibs.github.io/runner/"
          className="mb-8"
        >
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              When to use tasks:
            </h4>
            <ul className="space-y-2 text-gray-600 dark:text-gray-300">
              <li>
                • High-level business actions: "app.user.register",
                "app.order.process"
              </li>
              <li>• Operations that need middleware (auth, caching, retry)</li>
              <li>• Functions called from multiple places</li>
              <li>
                • Complex operations that benefit from dependency injection
              </li>
            </ul>
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              When not to use tasks:
            </h4>
            <ul className="space-y-2 text-gray-600 dark:text-gray-300">
              <li>• Simple utility functions</li>
              <li>• Code used in only one place</li>
              <li>• Performance-critical hot paths that don't need DI</li>
            </ul>
          </div>
        </ConceptCard>

        <ConceptCard
          id="resources"
          title="Resources"
          icon={conceptIcons.resources}
          iconBgGradient="bg-gradient-to-r from-green-500 to-blue-600"
          description="Resources are the singletons, services, configs, and connections that live throughout your app's lifecycle. They initialize once and stick around until cleanup time."
          codeExample={codeExamples.resources}
          apiHref="https://bluelibs.github.io/runner/"
          className="mb-8"
        >
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              Resource Configuration
            </h4>
            <p className="text-gray-600 dark:text-gray-300">
              Resources can be configured with type-safe options. No more
              "config object of unknown shape" nonsense.
            </p>
          </div>
        </ConceptCard>

        <ConceptCard
          id="events"
          title="Events"
          icon={conceptIcons.events}
          iconBgGradient="bg-gradient-to-r from-purple-500 to-pink-600"
          description="Events let different parts of your app talk to each other without tight coupling. It's like having a really good office messenger who never forgets anything."
          codeExample={codeExamples.events}
          apiHref="https://bluelibs.github.io/runner/"
          className="mb-8"
        >
          <div className="space-y-4">
            <p className="text-gray-600 dark:text-gray-300">
              You can listen to events using hooks. You can also listen to all
              events using <code>on: "*"</code>, and stop propagation of events.
            </p>
          </div>
        </ConceptCard>

        <ConceptCard
          id="hooks"
          title="Hooks"
          icon={conceptIcons.hooks}
          iconBgGradient="bg-gradient-to-r from-blue-500 to-purple-600"
          description="The modern way to listen to events is through hooks. They are lightweight event listeners, similar to tasks, but with a few key differences."
          codeExample={codeExamples.hooks}
          apiHref="https://bluelibs.github.io/runner/"
          className="mb-8"
        />

        <ConceptCard
          id="middleware"
          title="Middleware"
          icon={conceptIcons.middleware}
          iconBgGradient="bg-gradient-to-r from-orange-500 to-red-600"
          description="Middleware wraps around your tasks and resources, adding cross-cutting concerns without polluting your business logic."
          codeExample={codeExamples.middleware}
          apiHref="https://bluelibs.github.io/runner/"
        />
        <ConceptCard
          id="tags"
          title="Tags"
          icon={conceptIcons.tags}
          iconBgGradient="bg-gradient-to-r from-fuchsia-500 to-pink-600"
          description="Typed metadata and contracts for tasks/resources. Use tags for discovery, wiring, and enforcing output contracts."
          codeExample={codeExamples.metaAndTags}
          apiHref="https://bluelibs.github.io/runner/"
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
                components at runtime via <code>store.getTasksWithTag(tag)</code>
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
            <li><span className="font-semibold">Circular Dependencies:</span> fatal at runtime with a descriptive chain (A → B → A).</li>
            <li><span className="font-semibold">Override Precedence:</span> top‑down; the override closest to <code>run()</code> wins.</li>
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
          apiHref="https://bluelibs.github.io/runner/"
          className="mb-8"
        >
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              Available options
            </h4>
            <ul className="space-y-2 text-gray-600 dark:text-gray-300">
              <li>
                • <code>debug?: DebugFriendlyConfig</code> (default:
                <code>undefined</code>) — enables rich debug output and hooks
                into the Debug resource for development visibility.
              </li>
              <li>
                •{" "}
                <code>
                  logs?: &#123; printThreshold?: null | LogLevels;
                  printStrategy?: PrintStrategy; bufferLogs?: boolean &#125;
                </code>
                <div className="ml-5">
                  <div>
                    — <code>printThreshold</code> (default: <code>info</code>;
                    use <code>null</code> to disable)
                  </div>
                  <div>
                    — <code>printStrategy</code> (default: <code>PRETTY</code>)
                  </div>
                  <div>
                    — <code>bufferLogs</code> (default: <code>false</code>) —
                    buffer until the root resource is ready
                  </div>
                </div>
              </li>
              <li>
                • <code>errorBoundary?: boolean</code> (default:{" "}
                <code>true</code>) — installs a central error boundary for
                uncaught errors routed to <code>onUnhandledError</code>.
              </li>
              <li>
                • <code>shutdownHooks?: boolean</code> (default:{" "}
                <code>true</code>) — installs SIGINT/SIGTERM handlers that call{" "}
                <code>dispose()</code> for graceful shutdown.
              </li>
              <li>
                • <code>onUnhandledError?: OnUnhandledError</code> — custom
                handler for any unhandled error; defaults to logging via the
                created logger.
              </li>
              <li>
                • <code>dryRun?: boolean</code> (default: <code>false</code>) —
                validates setup without starting: resources aren't initialized
                and no events are emitted.
              </li>
              <li>
                • <code>runtimeCycleDetection?: boolean</code> (default:{" "}
                <code>true</code>) — forces runtime cycle detection for event
                emissions; disable to improve performance if you're sure there
                are no deadlocks.
              </li>
            </ul>
          </div>
        </ConceptCard>
      </section>

      {/* Advanced Features */}
      <section id="advanced" className="scroll-mt-24">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-8 flex items-center">
          <Zap className="w-8 h-8 mr-3" />
          Advanced Features
        </h2>

        <ConceptCard
          id="context"
          title="Context"
          icon={conceptIcons.context}
          iconBgGradient="bg-gradient-to-r from-indigo-500 to-purple-600"
          description="Request-scoped data without prop drilling. Pass data through the execution chain without explicitly threading it through every function call."
          codeExample={codeExamples.context}
          apiHref="https://bluelibs.github.io/runner/"
          className="mb-8"
        />

        <ConceptCard
          id="interceptors"
          title="Interceptors"
          icon={conceptIcons.interceptors}
          iconBgGradient="bg-gradient-to-r from-blue-500 to-purple-600"
          description="Dynamic task behavior modification at runtime. Perfect for debugging, metrics, or conditional logic."
          codeExample={codeExamples.interceptors}
          apiHref="https://bluelibs.github.io/runner/"
          className="mb-8"
        />

        <ConceptCard
          id="optional-deps"
          title="Optional Dependencies"
          icon={conceptIcons["optional-deps"]}
          iconBgGradient="bg-gradient-to-r from-green-500 to-blue-600"
          description="Graceful degradation patterns when dependencies aren't available. Build resilient systems that adapt to missing services."
          codeExample={codeExamples.optionalDeps}
          className="mb-8"
        />

        {/* Tags moved to Core Concepts */}

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
          className="mb-8"
        />

        <div id="event-cycle" className="card p-8 mb-8">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            Event Cycle Safety
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-3">
            The runner detects cycles during emission to prevent deadlocks (for example, <code>e1 → e2 → e1</code> in the same chain).
          </p>
          <ul className="list-disc ml-6 text-gray-700 dark:text-gray-300 space-y-1">
            <li>Readable error with the full emission chain</li>
            <li>Same‑hook re‑emits allowed only for idempotent cases</li>
            <li>Prefer one‑way flows; use <code>stopPropagation()</code> when needed</li>
          </ul>
        </div>

        <ConceptCard
          id="debug-resource"
          title="Debug Resource"
          icon={conceptIcons["debug-resource"]}
          iconBgGradient="bg-gradient-to-r from-orange-500 to-red-600"
          description="A powerful observability suite that hooks into the framework's execution pipeline to provide detailed insights into your application's behavior."
          codeExample={codeExamples.debugResource}
          apiHref="https://bluelibs.github.io/runner/"
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
          apiHref="https://bluelibs.github.io/runner/"
          className="mb-8"
        />

        <ConceptCard
          id="caching"
          title="Caching"
          icon={conceptIcons.caching}
          iconBgGradient="bg-gradient-to-r from-blue-500 to-cyan-600"
          description="Built-in LRU and custom cache providers. Automatic cache invalidation and warming strategies."
          codeExample={codeExamples.caching}
          apiHref="https://bluelibs.github.io/runner/"
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
          apiHref="https://bluelibs.github.io/runner/"
          className="mb-8"
        />

        <ConceptCard
          id="timeouts"
          title="Timeouts"
          icon={conceptIcons.timeouts}
          iconBgGradient="bg-gradient-to-r from-purple-500 to-pink-600"
          description="Operation timeout management with graceful degradation and cleanup handlers."
          codeExample={codeExamples.timeouts}
          apiHref="https://bluelibs.github.io/runner/"
          className="mb-8"
        />

        <ConceptCard
          id="shutdown"
          title="System Shutdown"
          icon={conceptIcons.shutdown}
          iconBgGradient="bg-gradient-to-r from-green-500 to-teal-600"
          description="Graceful shutdown and cleanup when your app needs to stop."
          codeExample={codeExamples.shutdown}
          apiHref="https://bluelibs.github.io/runner/"
          className="mb-8"
        />

        <ConceptCard
          id="unhandled-errors"
          title="Unhandled Errors"
          icon={conceptIcons["unhandled-errors"]}
          iconBgGradient="bg-gradient-to-r from-blue-500 to-cyan-600"
          description="The onUnhandledError callback is invoked by Runner whenever an error escapes normal handling."
          codeExample={codeExamples.unhandledErrors}
          apiHref="https://bluelibs.github.io/runner/"
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
          description="Real-world performance metrics showing 2.2M+ tasks per second with full middleware stack."
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
          apiHref="https://bluelibs.github.io/runner/"
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

      {/* Quick Reference */}
      <section className="card p-8 mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Quick Reference
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Essential Imports
            </h3>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
              <code className="text-sm text-gray-800 dark:text-gray-200">
                import &#123; resource, task, event, hook, run &#125; from
                "@bluelibs/runner";
              </code>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Run Options
            </h3>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
              <code className="text-sm text-gray-800 dark:text-gray-200">
                run(app, &#123; debug: "verbose", shutdownHooks: true &#125;)
              </code>
            </div>
          </div>
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
              Minimal guide for quick reference: lifecycle, tasks, resources, events
            </p>
          </a>
        </div>
      </section>
    </DocsLayout>
  );
};

export default DocsPage;
