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
            Registration wires your definitions into the system. If a task or
            resource isn't registered on the root resource, it won't exist at
            runtime, can't be discovered, intercepted, or depended on. Define
            your pieces, register them on the root, then call <code>run()</code>{" "}
            to boot and use helpers like <code>runTask()</code>.
          </p>
          <CodeBlock>{codeExamples.tasksQuickStart}</CodeBlock>
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
              Lifecycle: <code>run() → ready event → dispose()</code>
            </li>
            <li>Tasks: DI + middleware; validate input/result</li>
            <li>Resources: managed singletons with init/dispose</li>
            <li>Events: emit → validate → ordered hooks → run</li>
            <li>
              Hooks: async listeners; stoppable via{" "}
              <code>stopPropagation()</code>
            </li>
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
                Tasks are functions with superpowers. They're testable and
                composable. Unlike classes that accumulate methods like a
                hoarder accumulates stuff, tasks do one thing well.
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
                Resources are the singletons, services, configs, and connections
                that live throughout your app's lifecycle. They initialize once
                and stick around until cleanup time.
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
              Resource Configuration
            </h4>
            <p className="text-gray-600 dark:text-gray-300">
              Resources can be configured with type-safe options. No more
              "config object of unknown shape" nonsense.
            </p>
            <CodeBlock>
              {`const server = resource({
  id: "app.server",
  init: async (config: { port: number; host: string }) => {
    const app = express();
    return app.listen(config.port, config.host);
  },
  dispose: async (server) => server.close(),
});

// Register with configuration
const app = resource({
  id: "app",
  register: [
    // Unless all config fields are optional (or void),
    // you will be forced to register it with() configuration.
    server.with({ port: 3000, host: "localhost" })
  ],
});`}
            </CodeBlock>
          </div>
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
                Events let different parts of your app talk to each other
                without tight coupling. It's like having a really good office
                messenger who never forgets anything.
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
            <p className="text-gray-600 dark:text-gray-300">
              You can listen to events using hooks. You can also listen to all
              events using <code>on: "*"</code>, and stop propagation of events.
            </p>
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
                The modern way to listen to events is through hooks. They are
                lightweight event listeners, similar to tasks, but with a few
                key differences.
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
                Middleware wraps around tasks and resources to add cross‑cutting
                concerns (auth, caching, retries, timeouts, auditing) without
                polluting business logic. There are two kinds: task middleware
                and resource middleware.
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
                Runs around task execution. Ideal for authentication,
                input/result shaping, caching, retries, timeouts, and telemetry.
              </p>
              <CodeBlock>{codeExamples.middlewareTaskAuth}</CodeBlock>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className="space-y-2">
                  <h5 className="font-semibold text-gray-900 dark:text-white">
                    Compose built‑ins
                  </h5>
                  <p className="text-gray-600 dark:text-gray-300">
                    Use retry, timeout, and cache from{" "}
                    <code>globals.middleware.task</code>.
                  </p>
                  <CodeBlock>{codeExamples.middlewareResilientTask}</CodeBlock>
                </div>
                <div className="space-y-2">
                  <h5 className="font-semibold text-gray-900 dark:text-white">
                    Global task middleware
                  </h5>
                  <p className="text-gray-600 dark:text-gray-300">
                    Apply to all or a filtered set of tasks via{" "}
                    <code>everywhere</code>.
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
                Wraps resource initialization and can enhance the returned
                instance (e.g., patch methods, add guards, add observability).
              </p>
              <CodeBlock>{codeExamples.middlewareResourceSoftDelete}</CodeBlock>
              <div className="mt-4">
                <h5 className="font-semibold text-gray-900 dark:text-white">
                  Global resource middleware
                </h5>
                <p className="text-gray-600 dark:text-gray-300 mb-2">
                  Use <code>everywhere</code> to scope by predicate and apply
                  consistently.
                </p>
                <CodeBlock>{codeExamples.middlewareGlobalResource}</CodeBlock>
              </div>
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

        <ConceptCard
          id="context"
          title="Context"
          icon={conceptIcons.context}
          iconBgGradient="bg-gradient-to-r from-indigo-500 to-purple-600"
          description="Request-scoped data without prop drilling (works in Node only). Pass data through the execution chain without explicitly threading it through every function call."
          codeExample={codeExamples.context}
          apiHref="https://bluelibs.github.io/runner/#md:context"
          className="mb-8"
        />

        <ConceptCard
          id="interceptors"
          title="Interceptors"
          icon={conceptIcons.interceptors}
          iconBgGradient="bg-gradient-to-r from-blue-500 to-purple-600"
          description="Dynamic task behavior modification at runtime. Perfect for debugging, metrics, or conditional logic."
          codeExample={codeExamples.interceptors}
          apiHref="https://bluelibs.github.io/runner/#md:task-interceptors"
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
          id="overrides"
          title="Overrides"
          icon={conceptIcons.overrides}
          iconBgGradient="bg-gradient-to-r from-amber-500 to-orange-600"
          description="Swap implementations without changing IDs. Nearest override to run() wins; great for env‑specific behavior and tests."
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
