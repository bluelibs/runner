import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const TldrSection: React.FC = () => {
  return (
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
  );
};

export default TldrSection;