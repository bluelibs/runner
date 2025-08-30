import { Book, Zap, Shield, Timer, Activity, Eye, HardDrive, RotateCcw, Clock, BarChart3, TrendingUp } from "lucide-react";
import DocsLayout from "../components/docs/DocsLayout";
import ConceptCard from "../components/docs/ConceptCard";
import { allDocSections, conceptIcons } from "../data/documentation";
import { codeExamples } from "../data/codeExamples";

const DocsPage: React.FC = () => {
  return (
    <DocsLayout
      title="Documentation"
      description="Comprehensive guides and API reference for BlueLibs Runner. Everything you need to build production-ready applications."
      sidebarSections={allDocSections}
    >
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
          className="mb-8"
        >
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              When to use tasks:
            </h4>
            <ul className="space-y-2 text-gray-600 dark:text-gray-300">
              <li>• High-level business actions: "app.user.register", "app.order.process"</li>
              <li>• Operations that need middleware (auth, caching, retry)</li>
              <li>• Functions called from multiple places</li>
              <li>• Complex operations that benefit from dependency injection</li>
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
          className="mb-8"
        />

        <ConceptCard
          id="events"
          title="Events"
          icon={conceptIcons.events}
          iconBgGradient="bg-gradient-to-r from-purple-500 to-pink-600"
          description="Events let different parts of your app talk to each other without tight coupling. It's like having a really good office messenger who never forgets anything."
          codeExample={codeExamples.events}
          className="mb-8"
        />

        <ConceptCard
          id="middleware"
          title="Middleware"
          icon={conceptIcons.middleware}
          iconBgGradient="bg-gradient-to-r from-orange-500 to-red-600"
          description="Middleware wraps around your tasks and resources, adding cross-cutting concerns without polluting your business logic."
          codeExample={codeExamples.middleware}
        />
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
          className="mb-8"
        />

        <div id="interceptors" className="card p-8 mb-8 scroll-mt-24">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Interceptors
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Dynamic task behavior modification at runtime. Perfect for debugging, metrics, or conditional logic.
          </p>
        </div>

        <div id="optional-deps" className="card p-8 mb-8 scroll-mt-24">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Optional Dependencies
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Graceful degradation patterns when dependencies aren't available. Build resilient systems that adapt to missing services.
          </p>
        </div>

        <div id="task-hooks" className="card p-8 scroll-mt-24">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Task Hooks
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Lifecycle event handling for tasks. React to task execution events with custom logic.
          </p>
        </div>
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
          className="mb-8"
        />

        <ConceptCard
          id="caching"
          title="Caching"
          icon={conceptIcons.caching}
          iconBgGradient="bg-gradient-to-r from-blue-500 to-cyan-600"
          description="Built-in LRU and custom cache providers. Automatic cache invalidation and warming strategies."
          className="mb-8"
        />

        <ConceptCard
          id="retries"
          title="Retries"
          icon={conceptIcons.retries}
          iconBgGradient="bg-gradient-to-r from-orange-500 to-red-600"
          description="Automatic retry with exponential backoff, jitter, and circuit breaker patterns for resilient operations."
          className="mb-8"
        />

        <ConceptCard
          id="timeouts"
          title="Timeouts"
          icon={conceptIcons.timeouts}
          iconBgGradient="bg-gradient-to-r from-purple-500 to-pink-600"
          description="Operation timeout management with graceful degradation and cleanup handlers."
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

        <div id="monitoring" className="card p-8 mb-8 scroll-mt-24">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Monitoring
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Built-in performance monitoring with metrics collection and debugging tools.
          </p>
        </div>

        <div id="memory" className="card p-8 scroll-mt-24">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Memory Management
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Automatic resource lifecycle management with proper cleanup and garbage collection optimization.
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
              AI-Friendly Docs
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Condensed documentation for AI assistance
            </p>
          </a>
        </div>
      </section>
    </DocsLayout>
  );
};

export default DocsPage;